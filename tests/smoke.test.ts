import { SITE_NAME } from "../src/app/config";

describe("smoke", () => {
  it("has the site name", () => {
    expect(SITE_NAME).toBe("Stereo Set");
  });
});
