import type { AuthStrategy } from "./index.js";

export const noneAuth: AuthStrategy = {
  name: "none",
  async apply() {
    /* nothing to do */
  },
};
