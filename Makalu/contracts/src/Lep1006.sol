// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./Lep100Access.sol";
import "./libs/Strings.sol";

/// @title LEP100-6 — Lithosphere NFT Standard (ERC-721 equivalent)
contract Lep1006 is Lep100Access {
    using Strings for uint256;

    string public name;
    string public symbol;
    string internal _baseURI;
    bool public paused;

    uint256 public nextTokenId;
    uint256 public totalSupply;

    mapping(uint256 => address) internal _owners;
    mapping(address => uint256) internal _balances;
    mapping(uint256 => address) internal _tokenApprovals;
    mapping(address => mapping(address => bool)) internal _operatorApprovals;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Paused(address account);
    event Unpaused(address account);

    modifier whenNotPaused() { require(!paused, "paused"); _; }

    constructor(string memory _n, string memory _s, string memory base) {
        name = _n; symbol = _s; _baseURI = base;
        _setupRole(ADMIN_ROLE, msg.sender);
        _setupRole(MINTER_ROLE, msg.sender);
        _setupRole(PAUSER_ROLE, msg.sender);
    }

    function pause() external onlyRole(PAUSER_ROLE) { require(!paused); paused = true; emit Paused(msg.sender); }
    function unpause() external onlyRole(PAUSER_ROLE) { require(paused); paused = false; emit Unpaused(msg.sender); }
    function setBaseURI(string calldata base) external onlyRole(ADMIN_ROLE) { _baseURI = base; }

    function ownerOf(uint256 id) public view returns (address) {
        address o = _owners[id]; require(o != address(0), "nonexistent"); return o;
    }

    function balanceOf(address a) public view returns (uint256) {
        require(a != address(0)); return _balances[a];
    }

    function tokenURI(uint256 id) public view returns (string memory) {
        require(_owners[id] != address(0), "nonexistent");
        return string(abi.encodePacked(_baseURI, id.toString()));
    }

    function approve(address to, uint256 id) external {
        address o = ownerOf(id);
        require(msg.sender == o || isApprovedForAll(o, msg.sender));
        _tokenApprovals[id] = to; emit Approval(o, to, id);
    }

    function getApproved(uint256 id) public view returns (address) {
        require(_owners[id] != address(0), "nonexistent"); return _tokenApprovals[id];
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(msg.sender != operator);
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function _isApprovedOrOwner(address spender, uint256 id) internal view returns (bool) {
        address o = ownerOf(id);
        return (spender == o || getApproved(id) == spender || isApprovedForAll(o, spender));
    }

    function transferFrom(address from, address to, uint256 id) public whenNotPaused {
        require(_isApprovedOrOwner(msg.sender, id), "not approved");
        require(from == _owners[id], "wrong owner"); require(to != address(0));
        _tokenApprovals[id] = address(0);
        unchecked { _balances[from] -= 1; _balances[to] += 1; }
        _owners[id] = to; emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external { transferFrom(from, to, id); }
    function safeTransferFrom(address from, address to, uint256 id, bytes calldata) external { transferFrom(from, to, id); }

    /// Mint a specific token ID to `to`.
    function mint(address to, uint256 id) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(to != address(0)); require(_owners[id] == address(0), "already minted");
        _owners[id] = to; _balances[to] += 1; totalSupply += 1;
        emit Transfer(address(0), to, id);
    }

    /// Auto-increment mint — returns the new token ID.
    function safeMint(address to) external onlyRole(MINTER_ROLE) whenNotPaused returns (uint256 id) {
        require(to != address(0));
        id = nextTokenId++;
        _owners[id] = to; _balances[to] += 1; totalSupply += 1;
        emit Transfer(address(0), to, id);
    }

    function burn(uint256 id) external whenNotPaused {
        require(_isApprovedOrOwner(msg.sender, id), "not approved");
        address o = _owners[id];
        _tokenApprovals[id] = address(0);
        unchecked { _balances[o] -= 1; }
        delete _owners[id]; totalSupply -= 1;
        emit Transfer(o, address(0), id);
    }
}
