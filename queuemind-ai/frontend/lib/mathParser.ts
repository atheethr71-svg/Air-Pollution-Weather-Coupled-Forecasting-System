// Mathematical Vector & Calculus Engine for HapticGraph
// Computes curve coordinates, derivatives (tangent slope), inflection points, and physical tactile resistance.

export interface CriticalPoint {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  type: 'maximum' | 'minimum' | 'root' | 'inflection' | 'asymptote' | 'component';
  label: string;
}

export interface CurveDefinition {
  id: string;
  name: string;
  category: 'Calculus' | 'Physics' | 'Circuits' | 'Geometry';
  expressionStr: string;
  latexStr: string;
  description: string;
  xRange: [number, number]; // [min, max]
  yRange: [number, number]; // [min, max]
  fn: (x: number) => number;
  derivativeFn: (x: number) => number;
  criticalPoints: (xMin: number, xMax: number) => CriticalPoint[];
  specialComponents?: {
    x: number;
    y: number;
    label: string;
    type: 'resistor' | 'capacitor' | 'inductor' | 'diode' | 'charge';
    tactileHz: number;
  }[];
}

export const PRESET_CURVES: CurveDefinition[] = [
  {
    id: 'sine',
    name: 'Harmonic Sine Wave',
    category: 'Calculus',
    expressionStr: 'f(x) = sin(x)',
    latexStr: 'y = \\sin(x)',
    description: 'Fundamental periodic wave. Demonstrates alternating crests, troughs, and inflection points where concavity changes.',
    xRange: [-Math.PI * 2, Math.PI * 2],
    yRange: [-1.6, 1.6],
    fn: (x) => Math.sin(x),
    derivativeFn: (x) => Math.cos(x),
    criticalPoints: (xMin, xMax) => {
      const points: CriticalPoint[] = [];
      const step = 0.05;
      for (let x = xMin; x <= xMax; x += step) {
        // Roots (sin(x) = 0)
        if (Math.abs(Math.sin(x)) < 0.04 && Math.abs(Math.cos(x)) > 0.8) {
          const rootX = Math.round(x / Math.PI) * Math.PI;
          if (rootX >= xMin && rootX <= xMax && !points.some(p => Math.abs(p.x - rootX) < 0.2)) {
            points.push({
              x: rootX,
              y: 0,
              canvasX: 0,
              canvasY: 0,
              type: 'root',
              label: `Root (x = ${(rootX / Math.PI).toFixed(1)}π)`,
            });
          }
        }
        // Maxima (cos(x) = 0, sin(x) > 0)
        if (Math.abs(Math.cos(x)) < 0.04 && Math.sin(x) > 0.95) {
          const peakX = Math.round((x - Math.PI / 2) / (2 * Math.PI)) * 2 * Math.PI + Math.PI / 2;
          if (peakX >= xMin && peakX <= xMax && !points.some(p => Math.abs(p.x - peakX) < 0.2)) {
            points.push({
              x: peakX,
              y: 1,
              canvasX: 0,
              canvasY: 0,
              type: 'maximum',
              label: 'Local Maximum (Peak, Slope = 0)',
            });
          }
        }
        // Minima (cos(x) = 0, sin(x) < 0)
        if (Math.abs(Math.cos(x)) < 0.04 && Math.sin(x) < -0.95) {
          const troughX = Math.round((x + Math.PI / 2) / (2 * Math.PI)) * 2 * Math.PI - Math.PI / 2;
          if (troughX >= xMin && troughX <= xMax && !points.some(p => Math.abs(p.x - troughX) < 0.2)) {
            points.push({
              x: troughX,
              y: -1,
              canvasX: 0,
              canvasY: 0,
              type: 'minimum',
              label: 'Local Minimum (Trough, Slope = 0)',
            });
          }
        }
      }
      return points;
    },
  },
  {
    id: 'cubic-extrema',
    name: 'Cubic Polynomial & Tangent Bifurcation',
    category: 'Calculus',
    expressionStr: 'f(x) = 0.2(x³ - 3x)',
    latexStr: 'f(x) = \\frac{1}{5}(x^3 - 3x)',
    description: 'Classic calculus study for finding local maxima, local minima, and the point of inflection at origin where f"(x) = 0.',
    xRange: [-3, 3],
    yRange: [-2.5, 2.5],
    fn: (x) => 0.2 * (x * x * x - 3 * x),
    derivativeFn: (x) => 0.2 * (3 * x * x - 3),
    criticalPoints: () => [
      { x: -1, y: 0.2 * (-1 + 3), canvasX: 0, canvasY: 0, type: 'maximum', label: 'Local Maximum at x = -1.0 (Slope dy/dx = 0)' },
      { x: 0, y: 0, canvasX: 0, canvasY: 0, type: 'inflection', label: 'Point of Inflection at Origin (f"(x) = 0)' },
      { x: 1, y: 0.2 * (1 - 3), canvasX: 0, canvasY: 0, type: 'minimum', label: 'Local Minimum at x = +1.0 (Slope dy/dx = 0)' },
      { x: -1.732, y: 0, canvasX: 0, canvasY: 0, type: 'root', label: 'Root at x = -√3 (-1.73)' },
      { x: 1.732, y: 0, canvasX: 0, canvasY: 0, type: 'root', label: 'Root at x = +√3 (+1.73)' },
    ],
  },
  {
    id: 'damped-oscillation',
    name: 'Damped Harmonic Resonance',
    category: 'Physics',
    expressionStr: 'f(x) = e^(-0.25x) · cos(2x)',
    latexStr: 'y(t) = e^{-\\gamma t} \\cos(\\omega t)',
    description: 'Represents a real-world vibrating pendulum or RLC electrical circuit losing energy to viscous friction over time.',
    xRange: [0, 10],
    yRange: [-1.4, 1.4],
    fn: (x) => Math.exp(-0.25 * x) * Math.cos(2 * x),
    derivativeFn: (x) => -0.25 * Math.exp(-0.25 * x) * Math.cos(2 * x) - 2 * Math.exp(-0.25 * x) * Math.sin(2 * x),
    criticalPoints: () => [
      { x: 0, y: 1.0, canvasX: 0, canvasY: 0, type: 'maximum', label: 'Initial Displacement Peak (t = 0)' },
      { x: 1.57, y: 0, canvasX: 0, canvasY: 0, type: 'root', label: '1st Equilibrium Crossing' },
      { x: 3.14, y: -0.45, canvasX: 0, canvasY: 0, type: 'minimum', label: 'Damped Rebound Valley' },
      { x: 6.28, y: 0.20, canvasX: 0, canvasY: 0, type: 'maximum', label: 'Secondary Damped Peak' },
    ],
  },
  {
    id: 'projectile',
    name: 'Ballistic Projectile Trajectory',
    category: 'Physics',
    expressionStr: 'f(x) = -0.1x² + 0.8x',
    latexStr: 'y(x) = x \\tan(\\theta) - \\frac{g x^2}{2 v_0^2 \\cos^2(\\theta)}',
    description: 'Parabolic motion of an artillery projectile. Apex marks the point of zero vertical velocity where potential energy is maximized.',
    xRange: [-0.5, 8.5],
    yRange: [-0.5, 2.5],
    fn: (x) => -0.1 * x * x + 0.8 * x,
    derivativeFn: (x) => -0.2 * x + 0.8,
    criticalPoints: () => [
      { x: 0, y: 0, canvasX: 0, canvasY: 0, type: 'root', label: 'Launch Position (Ground Level)' },
      { x: 4.0, y: 1.6, canvasX: 0, canvasY: 0, type: 'maximum', label: 'Trajectory Apex (Vy = 0 m/s, Max Potential Energy)' },
      { x: 8.0, y: 0, canvasX: 0, canvasY: 0, type: 'root', label: 'Target Impact Point (Range = 8 units)' },
    ],
  },
  {
    id: 'rlc-circuit',
    name: 'RC Low-Pass Filter Topology',
    category: 'Circuits',
    expressionStr: 'V_out(t) = 5(1 - e^(-t/RC))',
    latexStr: 'V_{out}(t) = V_{in} (1 - e^{-t / \\tau})',
    description: 'Capacitor charging curve in an electrical engineering circuit. Tactile textures simulate resistor thermal dissipation and dielectric charge saturation.',
    xRange: [0, 8],
    yRange: [-0.5, 5.5],
    fn: (x) => 5 * (1 - Math.exp(-x / 1.5)),
    derivativeFn: (x) => (5 / 1.5) * Math.exp(-x / 1.5),
    criticalPoints: () => [
      { x: 0, y: 0, canvasX: 0, canvasY: 0, type: 'root', label: 'Initial Uncharged State (0V)' },
      { x: 1.5, y: 3.16, canvasX: 0, canvasY: 0, type: 'inflection', label: 'One Time Constant (τ = RC, 63.2% Charge)' },
      { x: 6.0, y: 4.9, canvasX: 0, canvasY: 0, type: 'maximum', label: 'Steady-State Saturation (~5.0V Asymptote)' },
    ],
    specialComponents: [
      { x: 1.0, y: 2.4, label: 'Series Resistor R = 10kΩ (Thermal Vibration 180Hz)', type: 'resistor', tactileHz: 180 },
      { x: 4.5, y: 4.7, label: 'Electrolytic Capacitor C = 100μF (Dielectric Saturation)', type: 'capacitor', tactileHz: 320 },
    ],
  },
];

// Custom Expression Safe Parser
export function parseCustomMathExpression(exprStr: string): {
  fn: (x: number) => number;
  derivativeFn: (x: number) => number;
  error: string | null;
} {
  try {
    // Sanitize input
    const cleanStr = exprStr
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/sin/g, 'Math.sin')
      .replace(/cos/g, 'Math.cos')
      .replace(/tan/g, 'Math.tan')
      .replace(/exp/g, 'Math.exp')
      .replace(/sqrt/g, 'Math.sqrt')
      .replace(/abs/g, 'Math.abs')
      .replace(/\^/g, '**')
      .replace(/pi/g, 'Math.PI')
      .replace(/e/g, 'Math.E');

    // Create function safely
    const func = new Function('x', `return ${cleanStr};`) as (x: number) => number;
    // Test execution
    const testVal = func(1);
    if (isNaN(testVal) || !isFinite(testVal)) {
      return { fn: (x) => 0, derivativeFn: (x) => 0, error: 'Expression produces NaN or non-finite values.' };
    }

    // Numerical derivative using central difference
    const h = 0.0001;
    const derivative = (x: number) => (func(x + h) - func(x - h)) / (2 * h);

    return { fn: func, derivativeFn: derivative, error: null };
  } catch (err: any) {
    return { fn: (x) => 0, derivativeFn: (x) => 0, error: err.message || 'Syntax error in expression.' };
  }
}
