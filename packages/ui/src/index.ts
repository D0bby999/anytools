export { cn } from './lib/cn';
export { Button, buttonVariants } from './components/button';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card';
export { Input } from './components/input';
export { Textarea } from './components/textarea';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/dialog';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/tooltip';
export { Badge, badgeVariants } from './components/badge';
export { CopyButton } from './components/copy-button';
export { PrivacyNote } from './components/privacy-note';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
} from './components/dropdown-menu';

// Mobile-first input primitives (Phase 1 general-public expansion)
export { NumberStepper } from './components/inputs/number-stepper';
export { CurrencyInput } from './components/inputs/currency-input';
export { RangeSlider } from './components/inputs/range-slider';
export { SegmentedControl } from './components/inputs/segmented-control';
export { HeightInput } from './components/inputs/height-input';
export { WeightInput } from './components/inputs/weight-input';

// Result card primitives
export { NumericPrimary } from './components/results/numeric-primary';
export { TableResult } from './components/results/table-result';
export { ChartFallback } from './components/results/chart-fallback';

// Tool page templates
export { CalculatorTemplate } from './components/tool-templates/calculator-template';
export { ConverterTemplate } from './components/tool-templates/converter-template';
export { PickerTemplate } from './components/tool-templates/picker-template';
export { GeneratorTemplate } from './components/tool-templates/generator-template';

// Locale hand-off from the page to tool widgets + shared widget labels.
export {
  ToolLocaleProvider,
  pickStrings,
  toUiLocale,
  useLocalized,
  useToolLocale,
} from './i18n/tool-locale';
export type { LocalizedStrings, UiLocale } from './i18n/tool-locale';
export { UI_STRINGS, useUiStrings } from './i18n/ui-strings';
