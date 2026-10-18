/**
 * tools-ui
 * The old AnyTools `packages/ui`, the part its tools use, restyled onto this
 * app's tokens (ui/web/DESIGN.md) so a tool reads as part of the app. Tools
 * import from here where they imported `@anytools/ui`.
 *
 * The old class vocabulary does not exist in this world and must not be
 * carried over when a tool is ported (app/test/tools-tokens.test.ts):
 *
 *   border-input            -> border-control-border
 *   ring-ring               -> ring-primary
 *   bg-popover, text-*-fg   -> bg-card, text-foreground
 *   bg-secondary            -> bg-muted
 *   bg-accent, text-accent  -> bg-primary / bg-primary-soft, text-primary
 *                              (accent here is terracotta: reading progress only)
 *   success                 -> primary ("ready" is the brand ink)
 *   bg-warning/10           -> bg-warning-soft
 *   bg-destructive/10       -> bg-destructive-soft
 *
 * Not ported, because no tool uses them: Dialog, Tooltip, DropdownMenu,
 * ChartFallback. Ported code keeps the old repo's formatting.
 */
export { Button, buttonVariants } from "./button";
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
export { Input } from "./input";
export { Textarea } from "./textarea";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
export { Badge, badgeVariants } from "./badge";
export { Label } from "./label";
export { Checkbox, CheckboxField } from "./checkbox";
export { RadioGroup, RadioGroupItem, RadioGroupField } from "./radio-group";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from "./select";
export { CopyButton } from "./copy-button";
export { PrivacyNote } from "./privacy-note";

export { NumberStepper } from "./inputs/number-stepper";
export { CurrencyInput } from "./inputs/currency-input";
export { RangeSlider } from "./inputs/range-slider";
export { ColorInput } from "./inputs/color-input";
export { SegmentedControl } from "./inputs/segmented-control";
export { HeightInput } from "./inputs/height-input";
export { WeightInput } from "./inputs/weight-input";
export { MultiFileDropzone, LARGE_FILE_WARN_BYTES } from "./inputs/multi-file-dropzone";
export type { MultiFileDropzoneProps } from "./inputs/multi-file-dropzone";

export { NumericPrimary } from "./results/numeric-primary";
export { TableResult } from "./results/table-result";

export { CalculatorTemplate } from "./templates/calculator-template";
export { ConverterTemplate } from "./templates/converter-template";
export { PickerTemplate } from "./templates/picker-template";
export { GeneratorTemplate } from "./templates/generator-template";
export { FilePipelineTemplate } from "./templates/file-pipeline-template";

export { ToolLocaleProvider, pickStrings, toUiLocale, useLocalized, useToolLocale } from "./i18n/tool-locale";
export type { LocalizedStrings, UiLocale } from "./i18n/tool-locale";
export { UI_STRINGS, useUiStrings } from "./i18n/ui-strings";
