export interface KeypointData {
  frame: number;
  bodyAngle: number; // Angle relative to horizontal
  elbowAngle: number;
  kneeAngle: number;
  phase: string;
}

export type AnalysisMode = 'A' | 'B';

export interface AnalysisReport {
  mode: AnalysisMode;
  // Mode A Fields
  impression?: string;
  stroke?: string;
  findings?: {
    metaphor: string;
    analysis: string; // Internal technical analysis
  }[];
  suggestions?: {
    mnemonic: string;
    drill: {
      name: string;
      purpose: string;
    };
  }[];
  // Mode B Fields
  metrics?: {
    swolf: number;
    dps: number;
    css?: string;
    finaPoints?: number;
    analysis: string;
  };
  trainingPlan?: {
    warmup: string;
    drills: string;
    mainSet: string;
    coolDown: string;
  };
  // Common
  growthAdvice: string;
  missingData?: string[];
}

export type StrokeType = 'Freestyle' | 'Breaststroke' | 'Backstroke' | 'Butterfly';
