// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title INGAM DelegationVault
/// @notice AI 에이전트에게 결제 권한을 "위임"하되, 한도·허용처·만료를 컨트랙트가 강제한다.
///         프론트엔드나 서버가 아니라 체인이 규칙을 들고 있기 때문에,
///         에이전트가 탈취되거나 운영 주체가 사라져도 한도는 뚫리지 않는다.
/// @dev    MVP는 네이티브 코인(ETH) 결제만 지원한다. ERC20은 Phase 1 과제.
contract DelegationVault {
    /* ─────────────────────────  타입  ───────────────────────── */

    struct Delegation {
        uint128 perTxLimit; // 1회 결제 한도
        uint128 dailyLimit; // 1일 누적 한도
        uint128 totalCap; // 위임 전체 기간 총 한도
        uint128 totalSpent; // 누적 사용액
        uint128 spentToday; // 오늘 사용액 (dayIndex 기준)
        uint64 dayIndex; // spentToday가 속한 날짜 (block.timestamp / 1 days)
        uint64 expiry; // 만료 시각 (unix). 이후 자동 무효
        bool active; // 회수되면 false
        bool whitelistOnly; // true면 허용된 수취인에게만 결제 가능
    }

    /* ─────────────────────────  저장소  ───────────────────────── */

    /// @notice 위임자(principal)가 금고에 예치한 잔액
    mapping(address => uint256) public balanceOf;

    /// @dev principal => agent => 위임 내용
    mapping(address => mapping(address => Delegation)) private _delegations;

    /// @notice principal => agent => 위임 회차. 재발급할 때마다 증가해서 예전 화이트리스트를 무효화한다.
    mapping(address => mapping(address => uint64)) public delegationNonce;

    /// @notice delegationId => 수취인 => 허용 여부
    /// @dev 온체인에서 실제로 자금을 받는 주소다. 정산 파트너 경로에서는 파트너 주소가 된다.
    mapping(bytes32 => mapping(address => bool)) public allowedRecipient;

    /// @notice delegationId => 가맹점 해시 => 허용 여부
    /// @dev 쿠팡·넷플릭스처럼 체인 밖에 있는 상점을 식별한다. 수취인과는 별개 층이다.
    ///      정산 파트너 한 곳만 수취인으로 두면 "어디에 쓸지" 통제가 사라지므로,
    ///      가맹점 단위 허용을 컨트랙트가 따로 강제한다.
    ///      해시는 keccak256(bytes(가맹점 식별자))이며 merchantId()로 계산할 수 있다.
    mapping(bytes32 => mapping(bytes32 => bool)) public allowedMerchant;

    /// @notice delegationId => 가맹점 정책 사용 여부. false면 가맹점 검사를 하지 않는다.
    mapping(bytes32 => bool) public merchantPolicyOn;

    uint256 private _locked = 1;

    /* ─────────────────────────  이벤트  ───────────────────────── */

    event Deposited(address indexed principal, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed principal, uint256 amount, uint256 newBalance);

    event DelegationCreated(
        bytes32 indexed id,
        address indexed principal,
        address indexed agent,
        uint128 perTxLimit,
        uint128 dailyLimit,
        uint128 totalCap,
        uint64 expiry,
        bool whitelistOnly
    );

    event RecipientSet(bytes32 indexed id, address indexed recipient, bool allowed);

    event MerchantSet(bytes32 indexed id, bytes32 indexed merchant, bool allowed);
    event MerchantPolicySet(bytes32 indexed id, bool enabled);

    event DelegationRevoked(
        bytes32 indexed id, address indexed principal, address indexed agent, uint128 totalSpent
    );

    event Spent(
        bytes32 indexed id,
        address indexed agent,
        address indexed recipient,
        address principal,
        uint256 amount,
        string memo,
        bytes32 merchant
    );

    /* ─────────────────────────  에러  ───────────────────────── */

    error Reentrancy();
    error ZeroAddress();
    error SelfRecipient();
    error ZeroAmount();
    error AmountTooLarge();
    error InvalidLimits();
    error ExpiryInPast();
    error NoDelegation();
    error DelegationInactive();
    error DelegationExpired(uint64 expiry, uint256 nowTs);
    error PerTxLimitExceeded(uint128 limit, uint256 requested);
    error DailyLimitExceeded(uint128 remaining, uint256 requested);
    error TotalCapExceeded(uint128 remaining, uint256 requested);
    error RecipientNotAllowed(address recipient);
    error MerchantNotAllowed(bytes32 merchant);
    error InsufficientBalance(uint256 available, uint256 requested);
    error TransferFailed();

    /* ─────────────────────────  가드  ───────────────────────── */

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    /* ─────────────────────────  금고  ───────────────────────── */

    /// @notice 위임 지갑에 사용할 자금을 예치한다.
    function deposit() public payable {
        if (msg.value == 0) revert ZeroAmount();
        uint256 newBalance = balanceOf[msg.sender] + msg.value;
        balanceOf[msg.sender] = newBalance;
        emit Deposited(msg.sender, msg.value, newBalance);
    }

    receive() external payable {
        deposit();
    }

    /// @notice 예치금을 회수한다. 위임이 살아 있어도 위임자는 언제든 빼갈 수 있다.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance(bal, amount);

        unchecked {
            balanceOf[msg.sender] = bal - amount;
        }
        emit Withdrawn(msg.sender, amount, bal - amount);

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /* ─────────────────────────  위임  ───────────────────────── */

    /// @notice 에이전트에게 결제 권한을 위임한다. 기존 위임이 있으면 덮어쓰며 사용액은 0으로 리셋된다.
    /// @param agent 권한을 받을 에이전트 지갑 주소
    /// @param perTxLimit 1회 결제 한도 (wei)
    /// @param dailyLimit 1일 누적 한도 (wei)
    /// @param totalCap 총 한도 (wei)
    /// @param expiry 만료 시각 (unix, 반드시 미래)
    /// @param whitelistOnly true면 recipients에 등록된 주소에만 결제 가능
    /// @param recipients 초기 허용 수취인 목록
    function createDelegation(
        address agent,
        uint128 perTxLimit,
        uint128 dailyLimit,
        uint128 totalCap,
        uint64 expiry,
        bool whitelistOnly,
        address[] calldata recipients
    ) external returns (bytes32 id) {
        if (agent == address(0)) revert ZeroAddress();
        if (perTxLimit == 0 || dailyLimit == 0 || totalCap == 0) revert InvalidLimits();
        if (perTxLimit > dailyLimit || dailyLimit > totalCap) revert InvalidLimits();
        if (expiry <= block.timestamp) revert ExpiryInPast();

        // 회차를 올려서 이전 위임의 화이트리스트가 되살아나지 않게 한다.
        uint64 nonce = delegationNonce[msg.sender][agent] + 1;
        delegationNonce[msg.sender][agent] = nonce;
        id = _idFor(msg.sender, agent, nonce);

        _delegations[msg.sender][agent] = Delegation({
            perTxLimit: perTxLimit,
            dailyLimit: dailyLimit,
            totalCap: totalCap,
            totalSpent: 0,
            spentToday: 0,
            dayIndex: uint64(block.timestamp / 1 days),
            expiry: expiry,
            active: true,
            whitelistOnly: whitelistOnly
        });

        emit DelegationCreated(
            id, msg.sender, agent, perTxLimit, dailyLimit, totalCap, expiry, whitelistOnly
        );

        for (uint256 i = 0; i < recipients.length; i++) {
            address r = recipients[i];
            if (r == address(0)) revert ZeroAddress();
            allowedRecipient[id][r] = true;
            emit RecipientSet(id, r, true);
        }
    }

    /// @notice 허용 수취인을 추가하거나 제거한다.
    function setRecipients(address agent, address[] calldata recipients, bool allowed) external {
        Delegation storage d = _delegations[msg.sender][agent];
        if (d.expiry == 0) revert NoDelegation();

        bytes32 id = _currentId(msg.sender, agent);
        for (uint256 i = 0; i < recipients.length; i++) {
            address r = recipients[i];
            if (r == address(0)) revert ZeroAddress();
            allowedRecipient[id][r] = allowed;
            emit RecipientSet(id, r, allowed);
        }
    }

    /// @notice 가맹점 정책을 켜거나 끈다. 켜면 spendAt()으로 가맹점을 명시해야 한다.
    function setMerchantPolicy(address agent, bool enabled) external {
        Delegation storage d = _delegations[msg.sender][agent];
        if (d.expiry == 0) revert NoDelegation();

        bytes32 id = _currentId(msg.sender, agent);
        merchantPolicyOn[id] = enabled;
        emit MerchantPolicySet(id, enabled);
    }

    /// @notice 허용 가맹점을 추가하거나 제거한다.
    /// @param merchants merchantId()로 계산한 해시 목록
    function setMerchants(address agent, bytes32[] calldata merchants, bool allowed) external {
        Delegation storage d = _delegations[msg.sender][agent];
        if (d.expiry == 0) revert NoDelegation();

        bytes32 id = _currentId(msg.sender, agent);
        for (uint256 i = 0; i < merchants.length; i++) {
            allowedMerchant[id][merchants[i]] = allowed;
            emit MerchantSet(id, merchants[i], allowed);
        }
    }

    /// @notice 가맹점 식별자를 해시로 바꾼다. 오프체인에서도 같은 방식으로 계산할 수 있다.
    function merchantId(string calldata name) external pure returns (bytes32) {
        return keccak256(bytes(name));
    }

    /// @notice 위임을 즉시 회수한다. 이 트랜잭션이 확정되는 순간부터 에이전트는 한 푼도 쓸 수 없다.
    function revoke(address agent) external {
        Delegation storage d = _delegations[msg.sender][agent];
        if (d.expiry == 0) revert NoDelegation();
        if (!d.active) revert DelegationInactive();

        d.active = false;
        emit DelegationRevoked(_currentId(msg.sender, agent), msg.sender, agent, d.totalSpent);
    }

    /* ─────────────────────────  결제  ───────────────────────── */

    /// @notice 에이전트가 위임자의 자금으로 결제한다. 모든 규칙 검사는 여기서 강제된다.
    /// @param principal 위임자 주소
    /// @param recipient 수취인
    /// @param amount 결제 금액 (wei)
    /// @param memo 온체인 감사 로그에 남길 메모 (예: "구독 결제 - 2026년 8월")
    function spend(address principal, address recipient, uint256 amount, string calldata memo)
        external
        nonReentrant
    {
        // 가맹점 정책이 켜져 있으면 가맹점을 명시하는 spendAt()을 써야 한다.
        // 이 검사는 _spend 안에서 하면 다른 에러에 가려지므로 여기서 하지 않고,
        // 정책이 켜진 경우 merchant가 0이라 allowedMerchant 검사에서 자연히 걸린다.
        _spend(principal, recipient, amount, memo, bytes32(0));
    }

    /// @notice 가맹점을 명시해 결제한다. 정산 파트너 경로에서 쓴다.
    /// @param merchant 가맹점 해시. merchantId("coupang") 처럼 계산한다.
    /// @dev recipient(자금을 받는 주소)와 merchant(구매한 상점)는 다른 층이다.
    ///      파트너가 대납하는 경우 recipient는 파트너이고 merchant는 쿠팡이 된다.
    function spendAt(
        address principal,
        address recipient,
        uint256 amount,
        string calldata memo,
        bytes32 merchant
    ) external nonReentrant {
        _spend(principal, recipient, amount, memo, merchant);
    }

    function _spend(
        address principal,
        address recipient,
        uint256 amount,
        string calldata memo,
        bytes32 merchant
    ) private {
        if (recipient == address(0)) revert ZeroAddress();
        // 금고 자신을 수취인으로 지정하면 receive()가 deposit()을 호출해
        // 그 금액이 금고 명의로 credit된다. 금고 주소에는 개인키가 없어 영구 회수 불가다.
        // 탈취는 아니지만 위임자 자금이 소각되므로 막는다.
        if (recipient == address(this)) revert SelfRecipient();
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert AmountTooLarge();

        Delegation storage d = _delegations[principal][msg.sender];
        if (d.expiry == 0) revert NoDelegation();
        if (!d.active) revert DelegationInactive();
        if (block.timestamp >= d.expiry) revert DelegationExpired(d.expiry, block.timestamp);

        // 한도 검사와 사용액 갱신은 별도 함수로 뺀다.
        // 여기서 다 하면 스택이 넘쳐 컴파일되지 않는다 (Stack too deep).
        _applyLimits(d, amount);

        bytes32 id = _currentId(principal, msg.sender);
        if (d.whitelistOnly && !allowedRecipient[id][recipient]) {
            revert RecipientNotAllowed(recipient);
        }
        // 가맹점 정책이 켜져 있으면 상점 단위 허용도 함께 검사한다.
        if (merchantPolicyOn[id] && !allowedMerchant[id][merchant]) {
            revert MerchantNotAllowed(merchant);
        }

        uint256 bal = balanceOf[principal];
        if (bal < amount) revert InsufficientBalance(bal, amount);
        unchecked {
            balanceOf[principal] = bal - amount;
        }

        emit Spent(id, msg.sender, recipient, principal, amount, memo, merchant);

        (bool ok,) = payable(recipient).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev 건당·일일·총 한도를 검사하고 사용액을 갱신한다.
    ///      _spend에서 분리한 이유는 스택 깊이 제한 때문이다.
    function _applyLimits(Delegation storage d, uint256 amount) private {
        if (amount > d.perTxLimit) revert PerTxLimitExceeded(d.perTxLimit, amount);

        // 날짜가 바뀌었으면 일일 사용액을 리셋한다.
        uint64 today = uint64(block.timestamp / 1 days);
        uint128 spentToday = d.dayIndex == today ? d.spentToday : 0;

        uint128 dailyLeft = d.dailyLimit - spentToday;
        if (amount > dailyLeft) revert DailyLimitExceeded(dailyLeft, amount);

        uint128 totalLeft = d.totalCap - d.totalSpent;
        if (amount > totalLeft) revert TotalCapExceeded(totalLeft, amount);

        unchecked {
            d.spentToday = spentToday + uint128(amount);
            d.totalSpent = d.totalSpent + uint128(amount);
        }
        d.dayIndex = today;
    }

    /* ─────────────────────────  조회  ───────────────────────── */

    function getDelegation(address principal, address agent)
        external
        view
        returns (Delegation memory)
    {
        return _delegations[principal][agent];
    }

    function delegationId(address principal, address agent) external view returns (bytes32) {
        return _currentId(principal, agent);
    }

    /// @notice 오늘 남은 한도와 총 남은 한도를 반환한다. 위임이 없거나 죽었으면 0.
    function remaining(address principal, address agent)
        public
        view
        returns (uint256 today, uint256 total)
    {
        Delegation storage d = _delegations[principal][agent];
        if (d.expiry == 0 || !d.active || block.timestamp >= d.expiry) return (0, 0);

        uint128 spentToday =
            d.dayIndex == uint64(block.timestamp / 1 days) ? d.spentToday : 0;
        today = d.dailyLimit - spentToday;
        total = d.totalCap - d.totalSpent;
        if (today > total) today = total;
    }

    /// @notice 결제가 가능한지 미리 확인한다. UI와 에이전트가 실행 전에 부르는 용도.
    /// @return ok 결제 가능 여부
    /// @return reason 불가 사유 (가능하면 빈 문자열)
    function canSpend(address principal, address agent, address recipient, uint256 amount)
        external
        view
        returns (bool ok, string memory reason)
    {
        Delegation storage d = _delegations[principal][agent];

        if (d.expiry == 0) return (false, "NO_DELEGATION");
        if (!d.active) return (false, "REVOKED");
        if (block.timestamp >= d.expiry) return (false, "EXPIRED");
        if (recipient == address(this)) return (false, "SELF_RECIPIENT");
        if (amount == 0) return (false, "ZERO_AMOUNT");
        if (amount > type(uint128).max) return (false, "AMOUNT_TOO_LARGE");
        if (amount > d.perTxLimit) return (false, "PER_TX_LIMIT");

        uint128 spentToday =
            d.dayIndex == uint64(block.timestamp / 1 days) ? d.spentToday : 0;
        if (amount > d.dailyLimit - spentToday) return (false, "DAILY_LIMIT");
        if (amount > d.totalCap - d.totalSpent) return (false, "TOTAL_CAP");

        if (d.whitelistOnly && !allowedRecipient[_currentId(principal, agent)][recipient]) {
            return (false, "RECIPIENT_NOT_ALLOWED");
        }
        // 가맹점 정책이 켜져 있으면 canSpendAt()으로 가맹점까지 넘겨 조회해야 한다.
        if (merchantPolicyOn[_currentId(principal, agent)]) return (false, "MERCHANT_REQUIRED");
        if (balanceOf[principal] < amount) return (false, "INSUFFICIENT_BALANCE");

        return (true, "");
    }

    /// @notice 가맹점을 포함해 결제 가능 여부를 조회한다.
    ///         정산 파트너(PG)가 승인 판단에 호출하는 함수다.
    ///         상태를 바꾸지 않으므로 승인 요청 처리 중에 자유롭게 부를 수 있다.
    function canSpendAt(
        address principal,
        address agent,
        address recipient,
        uint256 amount,
        bytes32 merchant
    ) external view returns (bool ok, string memory reason) {
        Delegation storage d = _delegations[principal][agent];

        if (d.expiry == 0) return (false, "NO_DELEGATION");
        if (!d.active) return (false, "REVOKED");
        if (block.timestamp >= d.expiry) return (false, "EXPIRED");
        if (recipient == address(this)) return (false, "SELF_RECIPIENT");
        if (amount == 0) return (false, "ZERO_AMOUNT");
        if (amount > type(uint128).max) return (false, "AMOUNT_TOO_LARGE");
        if (amount > d.perTxLimit) return (false, "PER_TX_LIMIT");

        uint128 spentToday =
            d.dayIndex == uint64(block.timestamp / 1 days) ? d.spentToday : 0;
        if (amount > d.dailyLimit - spentToday) return (false, "DAILY_LIMIT");
        if (amount > d.totalCap - d.totalSpent) return (false, "TOTAL_CAP");

        bytes32 id = _currentId(principal, agent);
        if (d.whitelistOnly && !allowedRecipient[id][recipient]) {
            return (false, "RECIPIENT_NOT_ALLOWED");
        }
        if (merchantPolicyOn[id] && !allowedMerchant[id][merchant]) {
            return (false, "MERCHANT_NOT_ALLOWED");
        }
        if (balanceOf[principal] < amount) return (false, "INSUFFICIENT_BALANCE");

        return (true, "");
    }

    /* ─────────────────────────  내부  ───────────────────────── */

    function _currentId(address principal, address agent) internal view returns (bytes32) {
        return _idFor(principal, agent, delegationNonce[principal][agent]);
    }

    function _idFor(address principal, address agent, uint64 nonce)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(principal, agent, nonce));
    }
}
