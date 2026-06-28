import { defineConfig } from "tsup";
import {
  generatePackageExports,
  generateTsupOptions,
  type PresetOptions,
  parsePresetOptions,
  writePackageJson,
} from "tsup-preset-solid";

const preset_options: PresetOptions = {
  // array or single object
  entries: [
    // default entry (index)
    {
      // entries with '.tsx' extension will have `solid` export condition generated
      entry: "src/index.tsx",
      // will generate a separate development entry
      dev_entry: true,
    },
  ],
  // Set to `true` to remove all `console.*` calls and `debugger` statements in prod builds
  drop_console: true,
  // Set to `true` to generate a CommonJS build alongside ESM
  // cjs: true,
};

const CI =
  process.env.CI === "true" ||
  process.env.GITHUB_ACTIONS === "true" ||
  process.env.CI === '"1"' ||
  process.env.GITHUB_ACTIONS === '"1"';

export default defineConfig((config) => {
  const watching = !!config.watch;

  const parsed_options = parsePresetOptions(preset_options, watching);

  if (!(watching || CI)) {
    const package_fields = generatePackageExports(parsed_options);
    const rootExport = package_fields.exports as {
      solid?: {
        development?: string;
        import?: string;
      };
    };
    const normalizedRootExport = {
      ...rootExport,
      solid: {
        ...rootExport.solid,
        development: "./dist/dev.js",
        import: "./dist/index.js",
      },
    };
    const normalized_exports = {
      ".": normalizedRootExport,
      "./styles.css": "./dist/styles.css",
    };
    const package_fields_with_styles = {
      ...package_fields,
      exports: normalized_exports,
    };

    console.log(
      `package.json: \n\n${JSON.stringify(package_fields_with_styles, null, 2)}\n\n`
    );

    // will update ./package.json with the correct export fields
    writePackageJson(package_fields_with_styles);
  }

  return generateTsupOptions(parsed_options);
});
