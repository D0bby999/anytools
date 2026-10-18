export type Category = 'length' | 'weight' | 'temperature' | 'volume' | 'speed';

// Each unit is defined by a factor relative to a canonical unit (or a custom function for temperature).
type Unit = {
  id: string;
  label: string;
  toCanonical: (v: number) => number;
  fromCanonical: (v: number) => number;
};

const linear = (factor: number, offset = 0): Pick<Unit, 'toCanonical' | 'fromCanonical'> => ({
  toCanonical: (v) => v * factor + offset,
  fromCanonical: (v) => (v - offset) / factor,
});

export const UNITS: Record<Category, Unit[]> = {
  length: [
    { id: 'm', label: 'Meter (m)', ...linear(1) },
    { id: 'cm', label: 'Centimeter (cm)', ...linear(0.01) },
    { id: 'mm', label: 'Millimeter (mm)', ...linear(0.001) },
    { id: 'km', label: 'Kilometer (km)', ...linear(1000) },
    { id: 'in', label: 'Inch (in)', ...linear(0.0254) },
    { id: 'ft', label: 'Foot (ft)', ...linear(0.3048) },
    { id: 'yd', label: 'Yard (yd)', ...linear(0.9144) },
    { id: 'mi', label: 'Mile (mi)', ...linear(1609.344) },
  ],
  weight: [
    { id: 'kg', label: 'Kilogram (kg)', ...linear(1) },
    { id: 'g', label: 'Gram (g)', ...linear(0.001) },
    { id: 'mg', label: 'Milligram (mg)', ...linear(0.000001) },
    { id: 't', label: 'Metric ton (t)', ...linear(1000) },
    { id: 'lb', label: 'Pound (lb)', ...linear(0.45359237) },
    { id: 'oz', label: 'Ounce (oz)', ...linear(0.028349523) },
  ],
  temperature: [
    {
      id: 'C',
      label: 'Celsius (°C)',
      toCanonical: (v) => v,
      fromCanonical: (v) => v,
    },
    {
      id: 'F',
      label: 'Fahrenheit (°F)',
      toCanonical: (v) => ((v - 32) * 5) / 9,
      fromCanonical: (v) => (v * 9) / 5 + 32,
    },
    {
      id: 'K',
      label: 'Kelvin (K)',
      toCanonical: (v) => v - 273.15,
      fromCanonical: (v) => v + 273.15,
    },
  ],
  volume: [
    { id: 'L', label: 'Liter (L)', ...linear(1) },
    { id: 'mL', label: 'Milliliter (mL)', ...linear(0.001) },
    { id: 'm3', label: 'Cubic meter (m³)', ...linear(1000) },
    { id: 'gal_us', label: 'US gallon', ...linear(3.785411784) },
    { id: 'gal_uk', label: 'UK gallon', ...linear(4.54609) },
    { id: 'fl_oz', label: 'US fluid ounce', ...linear(0.0295735) },
    { id: 'cup', label: 'US cup', ...linear(0.2365882) },
  ],
  speed: [
    { id: 'mps', label: 'Meter/second (m/s)', ...linear(1) },
    { id: 'kph', label: 'Kilometer/hour (km/h)', ...linear(1 / 3.6) },
    { id: 'mph', label: 'Mile/hour (mph)', ...linear(0.44704) },
    { id: 'kn', label: 'Knot', ...linear(0.514444) },
    { id: 'fps', label: 'Foot/second (ft/s)', ...linear(0.3048) },
  ],
};

export function convert(category: Category, fromId: string, toId: string, value: number): number {
  const units = UNITS[category];
  const from = units.find((u) => u.id === fromId);
  const to = units.find((u) => u.id === toId);
  if (!from || !to) return 0;
  return to.fromCanonical(from.toCanonical(value));
}
