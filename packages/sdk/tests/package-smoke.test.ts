import { describe, expect, it } from "vitest";

import * as sdk from "../src/index";

describe("public package", () => {
  it("exports the factory and error type", () => {
    expect(sdk).toHaveProperty("createDocLayout");
    expect(sdk).toHaveProperty("DocLayoutError");
  });
});
