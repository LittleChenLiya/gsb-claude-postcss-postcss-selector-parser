import Processor from "./processor";
import * as selectors from "./selectors";
import { applyRenamePlan, planRenames, RenameConflictError } from "./rename";

const parser = (processor?: any) => new Processor(processor);

Object.assign(parser, selectors);

Object.assign(parser, { applyRenamePlan, planRenames, RenameConflictError });

delete (parser as any).__esModule;

export = parser;
