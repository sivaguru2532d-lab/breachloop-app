/**
 * Entry point for the server-render test: exposes the real components and the real
 * view-model builder, so the test renders exactly what the console renders.
 * Bundled by tests/render.test.mjs via the esbuild JS API.
 */

import React from 'react';
import { renderToString } from 'react-dom/server';

import { SocConsole } from '@/components/SocConsole';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { HypothesisBar } from '@/components/HypothesisBar';
import { AttackGraph } from '@/components/AttackGraph';
import { EventTimeline } from '@/components/EventTimeline';
import { RemediationLab } from '@/components/RemediationLab';
import { TwinStateInspector } from '@/components/TwinStateInspector';
import { BenchmarkModal } from '@/components/BenchmarkModal';
import { LaunchPad } from '@/components/LaunchPad';
import { EvidenceReportView } from '@/components/EvidenceReportView';
import { AwsRef } from '@/components/AwsRef';
import { DynamicBackground } from '@/components/DynamicBackground';
import { QuizTrainer, EMPTY_SCORE, loadTrainerScore, saveTrainerScore } from '@/components/QuizTrainer';
import { buildIncidentResponse } from '@/lib/api/client';
import { filterLaunchTargets } from '@/lib/api/briefing';
import { formatTimestamp, truncateArn } from '@/lib/api/client';
import { awsDocFor, shortArn, serviceHintFromKey } from '@/components/AwsRef';

const components: Record<string, React.ComponentType<any>> = {
  SocConsole,
  Header,
  Sidebar,
  HypothesisBar,
  AttackGraph,
  EventTimeline,
  RemediationLab,
  TwinStateInspector,
  BenchmarkModal,
  EvidenceReportView,
  LaunchPad,
  AwsRef,
  DynamicBackground,
  QuizTrainer,
};

export function render(name: string, props: Record<string, unknown>): string {
  const Component = components[name];
  if (!Component) throw new Error(`unknown component ${name}`);
  return renderToString(React.createElement(Component, props));
}

export {
  buildIncidentResponse,
  filterLaunchTargets,
  formatTimestamp,
  truncateArn,
  awsDocFor,
  shortArn,
  serviceHintFromKey,
  QuizTrainer,
  EMPTY_SCORE,
  loadTrainerScore,
  saveTrainerScore,
};
