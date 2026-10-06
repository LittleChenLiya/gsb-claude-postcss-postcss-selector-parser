import Processor from "./processor";
import * as selectors from "./selectors";
import { applyRenamePlan, createRenamePlan, RenameConflictError, renameSelectors } from "./rename";

const parser = (processor?: any) => new Processor(processor);

Object.assign(parser, selectors);
Object.assign(parser, {
  applyRenamePlan,
  createRenamePlan,
  RenameConflictError,
  renameSelectors,
});

delete (parser as any).__esModule;

export = parser;
