const { expect } = require("chai");
const { ethers } = require("hardhat");

const HASH = ethers.sha256(ethers.toUtf8Bytes("hello vault"));
const OTHER_HASH = ethers.sha256(ethers.toUtf8Bytes("tampered"));
const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

describe("FileVault", () => {
  let vault, owner, alice, bob;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    vault = await (await ethers.getContractFactory("FileVault")).deploy();
    await vault.waitForDeployment();
  });

  const upload = (signer = owner) =>
    vault.connect(signer).uploadFile(HASH, CID, "meta-ciphertext", "owner-key-sealed");

  describe("uploadFile", () => {
    it("registers a file under the caller and emits FileUploaded", async () => {
      await expect(upload()).to.emit(vault, "FileUploaded").withArgs(1, owner.address, HASH, CID);
      expect(await vault.fileCount()).to.equal(1);
      expect(await vault.getOwnedFileIds(owner.address)).to.deep.equal([1n]);
    });

    it("rejects empty hash, cid and key", async () => {
      await expect(vault.uploadFile(ethers.ZeroHash, CID, "m", "k")).to.be.revertedWithCustomError(vault, "InvalidInput");
      await expect(vault.uploadFile(HASH, "", "m", "k")).to.be.revertedWithCustomError(vault, "InvalidInput");
      await expect(vault.uploadFile(HASH, CID, "m", "")).to.be.revertedWithCustomError(vault, "InvalidInput");
    });
  });

  describe("getFile / verifyFile", () => {
    beforeEach(async () => {
      await upload();
    });

    it("returns the record and the owner's sealed key to the owner", async () => {
      const f = await vault.getFile(1);
      expect(f.cid).to.equal(CID);
      expect(f.hash).to.equal(HASH);
      expect(f.owner).to.equal(owner.address);
      expect(f.key).to.equal("owner-key-sealed");
      expect(f.encMeta).to.equal("meta-ciphertext");
    });

    it("blocks users without permission", async () => {
      await expect(vault.connect(alice).getFile(1)).to.be.revertedWithCustomError(vault, "NotAllowed");
    });

    it("verifies the matching hash and rejects a changed one", async () => {
      expect(await vault.verifyFile(1, HASH)).to.equal(true);
      expect(await vault.verifyFile(1, OTHER_HASH)).to.equal(false);
    });

    it("reverts for unknown ids", async () => {
      await expect(vault.getFile(99)).to.be.revertedWithCustomError(vault, "FileNotFound");
      await expect(vault.verifyFile(0, HASH)).to.be.revertedWithCustomError(vault, "FileNotFound");
    });
  });

  describe("grantAccess / revokeAccess", () => {
    beforeEach(async () => {
      await upload();
    });

    it("lets the owner grant access and gives the recipient their own sealed key", async () => {
      await expect(vault.grantAccess(1, alice.address, "alice-key"))
        .to.emit(vault, "AccessGranted")
        .withArgs(1, owner.address, alice.address);
      const f = await vault.connect(alice).getFile(1);
      expect(f.key).to.equal("alice-key");
      expect(await vault.getSharedFileIds(alice.address)).to.deep.equal([1n]);
      expect(await vault.hasAccess(1, alice.address)).to.equal(true);
      expect(await vault.getAccessList(1)).to.deep.equal([alice.address]);
    });

    it("only the owner can grant or revoke", async () => {
      await expect(vault.connect(alice).grantAccess(1, bob.address, "k")).to.be.revertedWithCustomError(vault, "NotOwner");
      await vault.grantAccess(1, alice.address, "alice-key");
      await expect(vault.connect(alice).revokeAccess(1, alice.address)).to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("rejects duplicate grants, self grants, empty keys and revoking nobody", async () => {
      await vault.grantAccess(1, alice.address, "k");
      await expect(vault.grantAccess(1, alice.address, "k")).to.be.revertedWithCustomError(vault, "AlreadyGranted");
      await expect(vault.grantAccess(1, owner.address, "k")).to.be.revertedWithCustomError(vault, "InvalidInput");
      await expect(vault.grantAccess(1, bob.address, "")).to.be.revertedWithCustomError(vault, "InvalidInput");
      await expect(vault.revokeAccess(1, bob.address)).to.be.revertedWithCustomError(vault, "NotGranted");
    });

    it("revoke removes access, the key and the shared listing", async () => {
      await vault.grantAccess(1, alice.address, "alice-key");
      await vault.grantAccess(1, bob.address, "bob-key");
      await expect(vault.revokeAccess(1, alice.address))
        .to.emit(vault, "AccessRevoked")
        .withArgs(1, owner.address, alice.address);
      await expect(vault.connect(alice).getFile(1)).to.be.revertedWithCustomError(vault, "NotAllowed");
      expect(await vault.getSharedFileIds(alice.address)).to.deep.equal([]);
      expect(await vault.getAccessList(1)).to.deep.equal([bob.address]);
      expect((await vault.connect(bob).getFile(1)).key).to.equal("bob-key");
    });

    it("can re-grant after a revoke without duplicating the shared listing", async () => {
      await vault.grantAccess(1, alice.address, "k1");
      await vault.revokeAccess(1, alice.address);
      await vault.grantAccess(1, alice.address, "k2");
      expect(await vault.getSharedFileIds(alice.address)).to.deep.equal([1n]);
      expect((await vault.connect(alice).getFile(1)).key).to.equal("k2");
    });
  });

  describe("deleteFile", () => {
    beforeEach(async () => {
      await upload();
      await vault.grantAccess(1, alice.address, "alice-key");
    });

    it("only the owner can delete; deletion hides the file everywhere", async () => {
      await expect(vault.connect(alice).deleteFile(1)).to.be.revertedWithCustomError(vault, "NotOwner");
      await expect(vault.deleteFile(1)).to.emit(vault, "FileDeleted").withArgs(1, owner.address);
      expect(await vault.getOwnedFileIds(owner.address)).to.deep.equal([]);
      expect(await vault.getSharedFileIds(alice.address)).to.deep.equal([]);
      await expect(vault.getFile(1)).to.be.revertedWithCustomError(vault, "FileNotFound");
      expect(await vault.hasAccess(1, owner.address)).to.equal(false);
    });
  });

  describe("public key directory", () => {
    it("stores and returns a registered public key", async () => {
      await expect(vault.connect(alice).registerPublicKey("pubkey-b64"))
        .to.emit(vault, "PublicKeyRegistered")
        .withArgs(alice.address);
      expect(await vault.getPublicKey(alice.address)).to.equal("pubkey-b64");
      expect(await vault.getPublicKey(bob.address)).to.equal("");
    });

    it("rejects an empty key", async () => {
      await expect(vault.registerPublicKey("")).to.be.revertedWithCustomError(vault, "InvalidInput");
    });
  });
});
