import Container from "./container";
import { PSEUDO } from "./types";

export default class Pseudo extends Container {
  constructor(opts) {
    super(opts);
    this.type = PSEUDO;
  }

  _stringify(options, depth, max) {
    if (depth >= max) {
      throw new Error(`Cannot serialize selector: nesting depth exceeds the maximum of ${max}.`);
    }
    let params;
    if (this.length) {
      params =
        "(" +
        this.map((child) => this._stringifyChild(child, options, depth + 1, max)).join(",") +
        ")";
    } else if (this.raws && typeof this.raws.params === "string") {
      // Unknown functional pseudo-classes parsed in conservative mode keep
      // their argument text verbatim in `raws.params` instead of child nodes.
      params = "(" + this.raws.params + ")";
    } else {
      params = "";
    }
    return [this.rawSpaceBefore, this.stringifyProperty("value"), params, this.rawSpaceAfter].join(
      "",
    );
  }
}
