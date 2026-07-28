import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

async function readSiteFile(name: string) {
  return readFile(resolve(process.cwd(), "site", name), "utf8");
}

describe("public BrainHub site", () => {
  it("publishes the verified custom domain and legal navigation", async () => {
    const [cname, home, privacy, terms] = await Promise.all([
      readSiteFile("CNAME"),
      readSiteFile("index.html"),
      readSiteFile("privacy.html"),
      readSiteFile("terms.html"),
    ]);
    const normalizedHome = home.replace(/\s+/g, " ");

    expect(cname.trim()).toBe("brainhub.john-qh.com");
    expect(home).toContain("<title>BrainHub</title>");
    expect(normalizedHome).toContain("BrainHub 是一组本地优先的开源归档工具");
    expect(normalizedHome).toContain(
      "BrainHub 请求 Google Drive 权限的唯一目的",
    );
    expect(home).toContain('href="privacy.html"');
    expect(home).toContain('href="terms.html"');
    expect(privacy).toContain("Google API Services User Data Policy");
    expect(privacy).toContain("Limited Use");
    expect(terms).toContain("Apache License 2.0");
  });
});
