import { describe, expect, it } from "vitest";
import { discoverDependencies, splitIntoChunks } from "../server/ai-conversion.js";
import { defaultProviderConfig, stripCodeFences, validateProviderUrl } from "../server/ai-provider.js";
import { isPlausibleProviderKey, redactProviderKey } from "../server/bot-security.js";

describe("AI conversion helpers", () => {
  it("splits source into deterministic line-aware chunks", () => {
    const chunks = splitIntoChunks(Array.from({ length: 241 }, (_, index) => `line-${index + 1}`).join("\n"), 120);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, startLine: 1, endLine: 120 });
    expect(chunks[2]).toMatchObject({ chunkIndex: 2, startLine: 241, endLine: 241 });
  });

  it("discovers pip and npm dependencies without executing project files", () => {
    expect(discoverDependencies({ path: "requirements.txt", content: "requests>=2.0\n# comment\npython-dotenv", byteSize: 42, runtime: "python" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "requests", manager: "pip" }),
        expect.objectContaining({ name: "python-dotenv", manager: "pip" }),
      ]),
    );
    expect(discoverDependencies({ path: "package.json", content: JSON.stringify({ dependencies: { express: "^5.0.0" } }), byteSize: 42, runtime: "node" })).toEqual([
      expect.objectContaining({ name: "express", manager: "npm", versionSpec: "^5.0.0" }),
    ]);
  });

  it("keeps provider configuration HTTPS-only and supports both defaults", () => {
    expect(validateProviderUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(() => validateProviderUrl("http://api.example.com")).toThrow("HTTPS");
    expect(defaultProviderConfig("deepseek").baseUrl).toContain("deepseek.com");
    expect(defaultProviderConfig("nvidia").baseUrl).toContain("nvidia.com");
  });

  it("redacts provider keys and removes code fences from model output", () => {
    expect(isPlausibleProviderKey("sk-1234567890abcdef")).toBe(true);
    expect(redactProviderKey("sk-1234567890abcdef")).toBe("sk-1…cdef");
    expect(stripCodeFences("```python\nprint('ok')\n```")).toBe("print('ok')");
  });
});
