// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FileVault
 * @notice Records the SHA-256 hash, IPFS CID and access rights of client-side
 *         encrypted files. The contract NEVER stores a file or a plaintext key.
 *
 * What is stored per file
 *  - hash      SHA-256 of the ORIGINAL (plaintext) file, used for integrity checks
 *  - cid       IPFS content identifier of the ENCRYPTED file
 *  - encMeta   file name / type / size, encrypted with the file key (opaque here)
 *  - ownerKey  the file key, sealed with the owner's vault key (opaque here)
 *  - sharedKey the file key, sealed with a recipient's public key (per grant)
 *
 * Note: everything on a public chain can be read by anyone who parses contract
 * storage. Confidentiality therefore comes from the AES-256 encryption done in
 * the browser, not from the getters below.
 */
contract FileVault {
    // ---------------------------------------------------------------- types
    struct FileRecord {
        uint256 id;
        address owner;
        bytes32 hash;
        string cid;
        uint64 uploadedAt;
        bool deleted;
        string encMeta;
        string ownerKey;
    }

    /// Returned by getFile(): the caller's own copy of the sealed file key.
    struct FileView {
        uint256 id;
        address owner;
        bytes32 hash;
        string cid;
        uint64 uploadedAt;
        string encMeta;
        string key;
    }

    // -------------------------------------------------------------- storage
    uint256 public fileCount;

    mapping(uint256 => FileRecord) private files;
    mapping(uint256 => mapping(address => bool)) private allowed;
    mapping(uint256 => mapping(address => string)) private sharedKeys;
    mapping(uint256 => address[]) private accessList;
    mapping(address => uint256[]) private ownedIds;
    mapping(address => uint256[]) private sharedIds;
    mapping(uint256 => mapping(address => bool)) private listedForUser;
    mapping(address => string) private publicKeys;

    // --------------------------------------------------------------- events
    event FileUploaded(uint256 indexed id, address indexed owner, bytes32 hash, string cid);
    event AccessGranted(uint256 indexed id, address indexed owner, address indexed user);
    event AccessRevoked(uint256 indexed id, address indexed owner, address indexed user);
    event FileDeleted(uint256 indexed id, address indexed owner);
    event PublicKeyRegistered(address indexed user);

    // --------------------------------------------------------------- errors
    error FileNotFound(uint256 id);
    error NotOwner(uint256 id, address caller);
    error NotAllowed(uint256 id, address caller);
    error InvalidInput(string reason);
    error AlreadyGranted(uint256 id, address user);
    error NotGranted(uint256 id, address user);

    // ------------------------------------------------------------ modifiers
    modifier exists(uint256 id) {
        if (id == 0 || id > fileCount || files[id].deleted) revert FileNotFound(id);
        _;
    }

    modifier onlyOwner(uint256 id) {
        if (files[id].owner != msg.sender) revert NotOwner(id, msg.sender);
        _;
    }

    // ------------------------------------------------------- key directory
    /// Publish the public key other users need to share files with you.
    function registerPublicKey(string calldata publicKey) external {
        if (bytes(publicKey).length == 0) revert InvalidInput("empty public key");
        publicKeys[msg.sender] = publicKey;
        emit PublicKeyRegistered(msg.sender);
    }

    function getPublicKey(address user) external view returns (string memory) {
        return publicKeys[user];
    }

    // -------------------------------------------------------------- uploads
    /// Registers a new file under the caller's address.
    function uploadFile(
        bytes32 hash,
        string calldata cid,
        string calldata encMeta,
        string calldata ownerKey
    ) external returns (uint256 id) {
        if (hash == bytes32(0)) revert InvalidInput("empty hash");
        if (bytes(cid).length == 0) revert InvalidInput("empty cid");
        if (bytes(ownerKey).length == 0) revert InvalidInput("empty key");

        id = ++fileCount;
        files[id] = FileRecord({
            id: id,
            owner: msg.sender,
            hash: hash,
            cid: cid,
            uploadedAt: uint64(block.timestamp),
            deleted: false,
            encMeta: encMeta,
            ownerKey: ownerKey
        });
        ownedIds[msg.sender].push(id);

        emit FileUploaded(id, msg.sender, hash, cid);
    }

    /// True if `hash` equals the hash stored for the file. Anyone may call this.
    function verifyFile(uint256 id, bytes32 hash) external view exists(id) returns (bool) {
        return files[id].hash == hash;
    }

    // ---------------------------------------------------------- permissions
    /// Owner lets another address access the file. `wrappedKey` is the file key
    /// sealed with the recipient's public key (see registerPublicKey).
    function grantAccess(uint256 id, address user, string calldata wrappedKey)
        external
        exists(id)
        onlyOwner(id)
    {
        if (user == address(0) || user == msg.sender) revert InvalidInput("invalid user");
        if (bytes(wrappedKey).length == 0) revert InvalidInput("empty key");
        if (allowed[id][user]) revert AlreadyGranted(id, user);

        allowed[id][user] = true;
        sharedKeys[id][user] = wrappedKey;
        accessList[id].push(user);
        if (!listedForUser[id][user]) {
            listedForUser[id][user] = true;
            sharedIds[user].push(id);
        }
        emit AccessGranted(id, msg.sender, user);
    }

    /// Owner removes a previously granted permission.
    function revokeAccess(uint256 id, address user) external exists(id) onlyOwner(id) {
        if (!allowed[id][user]) revert NotGranted(id, user);

        allowed[id][user] = false;
        delete sharedKeys[id][user];

        address[] storage list = accessList[id];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == user) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        emit AccessRevoked(id, msg.sender, user);
    }

    function hasAccess(uint256 id, address user) public view returns (bool) {
        if (id == 0 || id > fileCount || files[id].deleted) return false;
        return files[id].owner == user || allowed[id][user];
    }

    // ---------------------------------------------------------------- reads
    /// Returns the file record (including the caller's sealed key) if the
    /// caller is the owner or an approved user.
    function getFile(uint256 id) external view exists(id) returns (FileView memory) {
        FileRecord storage f = files[id];
        bool isOwner = f.owner == msg.sender;
        if (!isOwner && !allowed[id][msg.sender]) revert NotAllowed(id, msg.sender);

        return FileView({
            id: f.id,
            owner: f.owner,
            hash: f.hash,
            cid: f.cid,
            uploadedAt: f.uploadedAt,
            encMeta: f.encMeta,
            key: isOwner ? f.ownerKey : sharedKeys[id][msg.sender]
        });
    }

    /// Ids of the (non-deleted) files owned by `user`.
    function getOwnedFileIds(address user) external view returns (uint256[] memory) {
        return _filter(ownedIds[user], user, true);
    }

    /// Ids of the (non-deleted) files currently shared with `user`.
    function getSharedFileIds(address user) external view returns (uint256[] memory) {
        return _filter(sharedIds[user], user, false);
    }

    /// Addresses that currently have access. Owner only.
    function getAccessList(uint256 id)
        external
        view
        exists(id)
        onlyOwner(id)
        returns (address[] memory)
    {
        return accessList[id];
    }

    // --------------------------------------------------------------- delete
    /// Owner removes the file record. The IPFS data itself cannot be erased.
    function deleteFile(uint256 id) external exists(id) onlyOwner(id) {
        FileRecord storage f = files[id];
        f.deleted = true;
        delete f.cid;
        delete f.encMeta;
        delete f.ownerKey;
        emit FileDeleted(id, msg.sender);
    }

    // ------------------------------------------------------------- internal
    function _filter(uint256[] storage ids, address user, bool owned)
        private
        view
        returns (uint256[] memory out)
    {
        uint256 n;
        for (uint256 i = 0; i < ids.length; i++) {
            if (_visible(ids[i], user, owned)) n++;
        }
        out = new uint256[](n);
        uint256 k;
        for (uint256 i = 0; i < ids.length; i++) {
            if (_visible(ids[i], user, owned)) out[k++] = ids[i];
        }
    }

    function _visible(uint256 id, address user, bool owned) private view returns (bool) {
        if (files[id].deleted) return false;
        return owned ? files[id].owner == user : allowed[id][user];
    }
}
