import {
  bundledReferencePlugins,
  createReferencePluginBootPlan,
  type ReferencePluginFeatureFlags,
} from "../dist/index";

const flags: ReferencePluginFeatureFlags = {
  pluginPlatform: true,
  toolbar: true,
  slashMenu: true,
  wordCount: true,
  blockDrag: true,
};
const plan = createReferencePluginBootPlan(flags);

void bundledReferencePlugins;
void plan.runtimePlugins;
