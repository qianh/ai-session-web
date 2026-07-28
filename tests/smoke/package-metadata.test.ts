import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("open-source package metadata", () => {
  it("declares the public project identity and Apache license", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as {
      name?: string;
      private?: boolean;
      license?: string;
      engines?: { node?: string };
    };
    const license = await readFile(resolve(process.cwd(), "LICENSE"), "utf8");

    expect(packageJson).toMatchObject({
      name: "brainhub-capture",
      private: true,
      license: "Apache-2.0",
      engines: { node: ">=22.12.0" },
    });
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
  });
});
