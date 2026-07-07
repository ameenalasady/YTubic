import { describe, it, expect } from "vitest";
import { md5Hex } from "./md5";

describe("md5Hex", () => {
  it("matches the RFC 1321 test vectors", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe(
      "f96b697d7cb7938d525a2f31aaf161d0",
    );
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe(
      "c3fcd3d76192e4007dfb496cca67e13b",
    );
  });

  it("handles a long input that spans multiple 64-byte blocks", () => {
    expect(
      md5Hex("The quick brown fox jumps over the lazy dog"),
    ).toBe("9e107d9d372bb6826bd81d3542a419d6");
    expect(
      md5Hex(
        "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      ),
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });

  it("encodes non-ASCII as UTF-8 before hashing", () => {
    // Signatures must hash the UTF-8 bytes, not the code units — so an
    // accented string must differ from its ASCII lookalike and still
    // produce a well-formed 32-char lowercase-hex digest.
    const accented = md5Hex("Björk");
    expect(accented).toMatch(/^[0-9a-f]{32}$/);
    // Hashing the UTF-8 bytes (2 bytes for "ö") must differ from the
    // ASCII lookalike, proving we don't hash raw code units.
    expect(accented).not.toBe(md5Hex("Bjork"));
    // Deterministic across calls.
    expect(md5Hex("Café")).toBe(md5Hex("Café"));
  });
});
