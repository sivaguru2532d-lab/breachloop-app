/**
 * AttackGraph - Interactive SVG visualization of attack path and topology
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Play, Pause, ZoomIn, ZoomOut, Minimize2, Maximize2 } from 'lucide-react';
import { AwsRef } from '@/components/AwsRef';
import type { AttackPath, CanonicalEvent, ScenarioDetail } from '@/lib/types';

/**
 * The union of topology sections a pack can contain. Typed structurally, and
 * deliberately not `any`: a renamed field must fail the compile, because a
 * dropped field here silently deletes nodes from the graph.
 */
type TopologyRecord = {
  id?: string;
  arn?: string;
  name?: string;
  is_compromised?: boolean;
  trust_policy?: unknown;
  execution_role_arn?: string;
};

interface NodePosition {
  x: number;
  y: number;
}

interface GraphNode {
  id: string;
  label: string;
  type: 'principal' | 'role' | 'resource' | 'workload';
  arn: string;
  isCompromised?: boolean;
  isTarget?: boolean;
  isOnAttackPath?: boolean;
  position: NodePosition;
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'assume' | 'permission' | 'observed' | 'workflow';
  isAttackPath: boolean;
  eventId?: string;
  label?: string;
}

interface AttackGraphProps {
  attackPath: AttackPath;
  /** Timeline events, accepted so the graph and the timeline stay swappable;
   *  the graph draws from the attack path and the topology sections. */
  events?: CanonicalEvent[];
  scenarioDetail: ScenarioDetail | null;
  className?: string;
}

const NODE_RADIUS = 28;
const NODE_SPACING_X = 220;
const NODE_SPACING_Y = 140;

// Must match the viewBox attribute on the graph <svg>.
const VIEWBOX_W = 1200;
const VIEWBOX_H = 600;

interface Transform {
  x: number;
  y: number;
  scale: number;
}

// Zoom while keeping the viewBox center fixed on screen.
function zoomAtCenter(prev: Transform, factor: number): Transform {
  const scale = Math.min(Math.max(prev.scale * factor, 0.3), 3);
  const ratio = scale / prev.scale;
  return {
    scale,
    x: VIEWBOX_W / 2 - ratio * (VIEWBOX_W / 2 - prev.x),
    y: VIEWBOX_H / 2 - ratio * (VIEWBOX_H / 2 - prev.y),
  };
}

function getNodeColor(type: GraphNode['type'], node: GraphNode): string {
  if (node.isCompromised) return 'var(--accent-critical)';
  if (node.isTarget) return 'var(--accent-critical)';
  if (node.isOnAttackPath) {
    switch (type) {
      case 'principal': return 'var(--accent-info)';
      case 'role': return 'var(--accent-warning)';
      case 'resource': return 'var(--accent-critical)';
      case 'workload': return '#A855F7';
    }
  }
  switch (type) {
    case 'principal': return 'var(--accent-info)';
    case 'role': return 'var(--accent-warning)';
    case 'resource': return 'var(--accent-critical)';
    case 'workload': return '#A855F7';
  }
}

function getNodeStroke(type: GraphNode['type'], node: GraphNode): string {
  if (node.isCompromised || node.isTarget) return 'var(--accent-critical)';
  if (node.isOnAttackPath) return 'var(--accent-info)';
  return 'var(--border-emphasis)';
}

function getNodeStrokeWidth(node: GraphNode): number {
  if (node.isCompromised || node.isTarget) return 3;
  if (node.isOnAttackPath) return 2;
  return 1;
}

function isFiniteNode(node: GraphNode): boolean {
  return (
    typeof node?.position?.x === 'number' &&
    typeof node?.position?.y === 'number' &&
    Number.isFinite(node.position.x) &&
    Number.isFinite(node.position.y)
  );
}

/** Guards every numeric prop handed to SVG, so a NaN can't blank the canvas. */
function safe(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The reveal is cosmetic: a staged draw of the attack path. Users who ask for
 * reduced motion get the finished graph immediately — the component must never
 * animate against that preference, even though CSS already flattens the
 * keyframe animations, because this loop is driven from JS.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function truncateLabel(label: string, maxLength = 18): string {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 1) + '…';
}

export function AttackGraph({ attackPath, scenarioDetail, className = '' }: AttackGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [animationProgress, setAnimationProgress] = useState(() => (prefersReducedMotion() ? 1 : 0));
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const animationFrameRef = useRef<number>();

  // Build graph from attack path and scenario detail.
  // Every input is normalized here: a partial payload must produce a smaller
  // graph, never a throw inside render (that used to take the whole console down).
  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const edgeList: GraphEdge[] = [];

    const steps = Array.isArray(attackPath?.steps) ? attackPath.steps : [];
    const detail = scenarioDetail;
    if (!detail) {
      return { nodes: [], edges: [] };
    }

    const nodeRecords: TopologyRecord[] = [
      ...(Array.isArray(detail.principals) ? detail.principals : []),
      ...(Array.isArray(detail.roles) ? detail.roles : []),
      ...(Array.isArray(detail.resources) ? detail.resources : []),
      ...(Array.isArray(detail.workloads) ? detail.workloads : []),
    ];

    // Add all nodes from scenario
    nodeRecords.forEach((node) => {
      const type = node.is_compromised !== undefined ? 'principal' :
                   node.trust_policy !== undefined ? 'role' :
                   node.execution_role_arn !== undefined ? 'workload' : 'resource';

      let isCompromised = false;
      let isTarget = false;
      let isOnAttackPath = false;

      if (type === 'principal' && node.arn === attackPath?.initial_compromise) {
        isCompromised = true;
        isOnAttackPath = true;
      }
      if (type === 'resource' && node.arn === attackPath?.target_resource) {
        isTarget = true;
        isOnAttackPath = true;
      }

      // Check if node is on attack path
      steps.forEach(step => {
        if (step.source_node === node.arn || step.target_node === node.arn) {
          isOnAttackPath = true;
        }
      });

      // One ARN can legitimately appear in two sections — an EC2 instance
      // profile role is listed as the compromised principal *and* as an IAM
      // role. Keying by ARN must merge, not replace, or the second record
      // silently erases the attacker entry point's highlight.
      const key = node.arn || node.id;
      if (!key) return;

      const existing = nodeMap.get(key);
      if (existing) {
        existing.isCompromised = existing.isCompromised || isCompromised;
        existing.isTarget = existing.isTarget || isTarget;
        existing.isOnAttackPath = existing.isOnAttackPath || isOnAttackPath;
        return;
      }

      nodeMap.set(key, {
        id: node.id ?? node.arn ?? key,
        label: node.name || node.arn?.split('/').pop() || node.arn?.split(':').pop() || 'Unknown',
        type,
        arn: node.arn ?? key,
        isCompromised,
        isTarget,
        isOnAttackPath,
        position: { x: 0, y: 0 },
      });
    });

    // Add attack path edges
    steps.forEach((step) => {
      edgeList.push({
        source: step.source_node,
        target: step.target_node,
        type: 'observed',
        isAttackPath: true,
        eventId: step.evidence_event_id,
        label: step.action,
      });
    });

    // Add workflow edges (benign)
    ;(Array.isArray(detail.workflows) ? detail.workflows : []).forEach(workflow => {
      edgeList.push({
        source: workflow.principal_arn,
        target: workflow.target_resource_arn,
        type: 'workflow',
        isAttackPath: false,
        label: workflow.required_action,
      });
    });

    // Layout nodes in a flow from left to right
    const nodeArray = Array.from(nodeMap.values());

    // Group by type for layout
    const principals = nodeArray.filter(n => n.type === 'principal');
    const roles = nodeArray.filter(n => n.type === 'role');
    const workloads = nodeArray.filter(n => n.type === 'workload');
    const resources = nodeArray.filter(n => n.type === 'resource');

    // Position in columns
    const columns = [principals, roles, workloads, resources].filter(c => c.length > 0);
    const startX = 100;

    columns.forEach((col, colIdx) => {
      const colX = startX + colIdx * NODE_SPACING_X;
      const totalHeight = (col.length - 1) * NODE_SPACING_Y;
      const startY = -totalHeight / 2;

      col.forEach((node, rowIdx) => {
        node.position = { x: colX, y: startY + rowIdx * NODE_SPACING_Y };
      });
    });

    return { nodes: nodeArray.filter(isFiniteNode), edges: edgeList };
  }, [attackPath, scenarioDetail]);

  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  // A node that leaves the graph (scenario switch) must not leave a dangling selection.
  useEffect(() => {
    if (selectedNodeId && !nodes.some(n => n.id === selectedNodeId)) setSelectedNodeId(null);
  }, [nodes, selectedNodeId]);

  // Animation loop
  useEffect(() => {
    if (!isAnimating) return;
    if (prefersReducedMotion()) {
      setAnimationProgress(1);
      setIsAnimating(false);
      return;
    }

    const animate = () => {
      setAnimationProgress(prev => {
        const next = prev + 0.008;
        if (next >= 1) {
          setIsAnimating(false);
          return 1;
        }
        return next;
      });
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isAnimating]);

  // Reset animation when attack path changes
  useEffect(() => {
    if (prefersReducedMotion()) {
      setAnimationProgress(1);
      setIsAnimating(false);
      return;
    }
    setAnimationProgress(0);
    setIsAnimating(true);
  }, [attackPath]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setTransform(prev => zoomAtCenter(prev, e.deltaY > 0 ? 0.9 : 1.1));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    // Convert screen pixels to viewBox units (preserveAspectRatio="meet").
    const rect = svg.getBoundingClientRect();
    const k = Math.min(rect.width / VIEWBOX_W, rect.height / VIEWBOX_H) || 1;
    const startX = e.clientX - transform.x * k;
    const startY = e.clientY - transform.y * k;

    const handleMove = (moveEvent: MouseEvent) => {
      setTransform(prev => ({
        ...prev,
        x: (moveEvent.clientX - startX) / k,
        y: (moveEvent.clientY - startY) / k,
      }));
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const resetView = () => {
    fitToView();
  };

  const fitToView = () => {
    if (!gRef.current || typeof gRef.current.getBBox !== 'function') return;
    let bbox: DOMRect;
    try {
      // getBBox on the transformed <g> excludes its own transform and returns
      // coordinates in viewBox units - the same space translate/scale operate in.
      bbox = gRef.current.getBBox();
    } catch {
      // Thrown by some engines when the subtree is not laid out yet; the next
      // ResizeObserver tick will fit correctly.
      return;
    }
    if (!bbox || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) return;
    if (!bbox.width || !bbox.height) return;
    const padding = 60;
    const rawScale = Math.min(
      (VIEWBOX_W - padding * 2) / bbox.width,
      (VIEWBOX_H - padding * 2) / bbox.height,
      1.5
    );
    const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
    const x = VIEWBOX_W / 2 - (bbox.x + bbox.width / 2) * scale;
    const y = VIEWBOX_H / 2 - (bbox.y + bbox.height / 2) * scale;
    setTransform({ x, y, scale });
  };

  // Fit the graph whenever nodes change or the container resizes (any viewport).
  useEffect(() => {
    fitToView();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitToView());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [nodes]);

  // Settle into a fitted view once the entrance animation completes.
  useEffect(() => {
    if (!isAnimating && animationProgress >= 1) {
      fitToView();
    }
  }, [isAnimating, animationProgress]);

  return (
    <div className={`attack-graph ${className}`} ref={containerRef} onWheel={handleWheel} onMouseDown={handleMouseDown} style={{ minHeight: '400px', position: 'relative' }}>
      <div className="attack-graph__controls">
        <button className="btn btn--ghost btn--icon btn--sm" onClick={fitToView} aria-label="Fit to view" title="Fit to View">
          <Maximize2 size={14} />
        </button>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={resetView} aria-label="Reset view" title="Reset View">
          <Minimize2 size={14} />
        </button>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setTransform(p => zoomAtCenter(p, 1.2))} aria-label="Zoom in" title="Zoom In">
          <ZoomIn size={14} />
        </button>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setTransform(p => zoomAtCenter(p, 0.8))} aria-label="Zoom out" title="Zoom Out">
          <ZoomOut size={14} />
        </button>
        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => {
            const reduced = prefersReducedMotion();
            setAnimationProgress(reduced ? 1 : 0);
            setIsAnimating(!reduced);
          }}
          aria-label={isAnimating ? 'Pause animation' : 'Replay animation'}
          title={isAnimating ? 'Pause' : 'Replay'}
        >
          {isAnimating ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </div>

      <svg
        ref={svgRef}
        className="attack-graph__canvas"
        width="100%"
        height="100%"
        viewBox="0 0 1200 600"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Arrow marker for edges */}
          <marker id="arrowhead-attack" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L10,3.5 L0,7 Z" fill="var(--accent-critical)" />
          </marker>
          <marker id="arrowhead-workflow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L10,3.5 L0,7 Z" fill="var(--accent-info)" />
          </marker>
          <marker id="arrowhead-default" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L10,3.5 L0,7 Z" fill="var(--border-emphasis)" />
          </marker>

          {/* Gradient for attack path pulse */}
          <linearGradient id="pulseGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--accent-critical)" stopOpacity="0" />
            <stop offset={`${animationProgress * 100}%`} stopColor="var(--accent-critical)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--accent-critical)" stopOpacity="0" />
          </linearGradient>

          {/* Glow filters */}
          <filter id="glow-critical" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feFlood floodColor="var(--accent-critical)" floodOpacity="0.6" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode />
            </feMerge>
          </filter>
          <filter id="glow-verified" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feFlood floodColor="var(--accent-verified)" floodOpacity="0.6" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode />
            </feMerge>
          </filter>
          <filter id="glow-info" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feFlood floodColor="var(--accent-info)" floodOpacity="0.6" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode />
            </feMerge>
          </filter>
        </defs>

        {/* Background grid (static backdrop, excluded from fit-to-view) */}
        <g stroke="var(--border-subtle)" strokeWidth="0.5" opacity="0.3">
          {Array.from({ length: 40 }).map((_, i) => (
            <line key={`h${i}`} x1={i * 30} y1="0" x2={i * 30} y2="600" />
          ))}
          {Array.from({ length: 20 }).map((_, i) => (
            <line key={`v${i}`} x1="0" y1={i * 30} x2="1200" y2={i * 30} />
          ))}
        </g>

        <g
          ref={gRef}
          transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}
          style={{ transition: 'transform 100ms ease-out' }}
        >

        {/* Edges */}
        <g strokeWidth="2" fill="none">
          {edges.map((edge, idx) => {
            const sourceNode = nodes.find(n => n.arn === edge.source);
            const targetNode = nodes.find(n => n.arn === edge.target);
            if (!sourceNode || !targetNode) return null;

            const isAttack = edge.isAttackPath;
            const strokeColor = isAttack ? 'var(--accent-critical)' :
                              edge.type === 'workflow' ? 'var(--accent-info)' : 'var(--border-emphasis)';
            const strokeDash = isAttack ? '8,4' : edge.type === 'workflow' ? '4,4' : 'none';
            const marker = isAttack ? 'url(#arrowhead-attack)' :
                          edge.type === 'workflow' ? 'url(#arrowhead-workflow)' : 'url(#arrowhead-default)';
            const filter = isAttack ? 'url(#glow-critical)' : edge.type === 'workflow' ? 'url(#glow-info)' : 'none';

            // Calculate curve control point
            const sx = safe(sourceNode.position.x);
            const sy = safe(sourceNode.position.y);
            const tx = safe(targetNode.position.x);
            const ty = safe(targetNode.position.y);
            const dx = tx - sx;
            const dy = ty - sy;
            const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const cx = sx + dx * 0.5 - dy * 0.15;
            const cy = sy + dy * 0.5 + dx * 0.15;

            // Animation progress for this edge
            const edgeProgress = Math.max(0, Math.min(1, animationProgress - idx * 0.15));
            const pathLength = distance;
            const dashOffset = (1 - edgeProgress) * pathLength;

            return (
              <g key={idx}>
                <path
                  d={`M${sx},${sy} Q${safe(cx)},${safe(cy)} ${tx},${ty}`}
                  stroke={strokeColor}
                  strokeDasharray={strokeDash === 'none' ? `${pathLength} ${pathLength}` : strokeDash}
                  strokeDashoffset={strokeDash === 'none' ? dashOffset : 0}
                  markerEnd={marker}
                  filter={filter}
                  style={{
                    transition: 'stroke-dashoffset 100ms linear',
                  }}
                />
                {edge.label && (
                  <text
                    x={safe((sx + tx) / 2)}
                    y={safe((sy + ty) / 2 - 8)}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                    fill={strokeColor}
                    opacity={edgeProgress}
                    style={{ pointerEvents: 'none' }}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {nodes.map((node, idx) => {
            const color = getNodeColor(node.type, node);
            const stroke = getNodeStroke(node.type, node);
            const strokeWidth = getNodeStrokeWidth(node);
            const isSelected = selectedNodeId === node.id;

            // Entrance animation
            const nodeProgress = Math.max(0, Math.min(1, animationProgress * 1.5 - idx * 0.05));
            const scale = nodeProgress;
            const opacity = nodeProgress;

            return (
              <g
                key={node.id}
                transform={`translate(${node.position.x}, ${node.position.y}) scale(${scale})`}
                style={{ opacity, cursor: 'pointer' }}
                onClick={() => setSelectedNodeId(selectedNodeId === node.id ? null : node.id)}
              >
                {/* Pulse ring for compromised/target */}
                {(node.isCompromised || node.isTarget) && (
                  <circle
                    r={NODE_RADIUS + 8 + Math.sin(animationProgress * Math.PI * 4) * 4}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray="8,4"
                    style={{
                      animation: 'pulse-ring 2s ease-in-out infinite',
                      opacity: 0.6,
                    }}
                  />
                )}

                {/* Node circle */}
                <circle
                  r={NODE_RADIUS}
                  fill="var(--bg-panel)"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  filter={node.isOnAttackPath ? (node.type === 'resource' ? 'url(#glow-critical)' : 'url(#glow-info)') : 'none'}
                />

                {/* Node icon */}
                {node.type === 'principal' && (
                  <path
                    d="M-6,6 L0,-8 L6,6 Z M0,-4 L0,4"
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {node.type === 'role' && (
                  <g>
                    <rect x={-8} y={-5} width={16} height={10} rx={2} fill="none" stroke={color} strokeWidth={2} />
                    <line x1={-4} y1={0} x2={4} y2={0} stroke={color} strokeWidth={2} strokeLinecap="round" />
                    <line x1={0} y1={-3} x2={0} y2={3} stroke={color} strokeWidth={2} strokeLinecap="round" />
                  </g>
                )}
                {node.type === 'resource' && (
                  <g>
                    <path d="M-8,6 L0,-8 L8,6 L8,10 L-8,10 Z" fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
                    <line x1={-4} y1={0} x2={4} y2={0} stroke={color} strokeWidth={2} strokeLinecap="round" />
                    <line x1={0} y1={-3} x2={0} y2={3} stroke={color} strokeWidth={2} strokeLinecap="round" />
                  </g>
                )}
                {node.type === 'workload' && (
                  <g>
                    <rect x={-8} y={-6} width={16} height={12} rx={2} fill="none" stroke={color} strokeWidth={2} />
                    <rect x={-4} y={-2} width={8} height={8} rx={1} fill={color} />
                  </g>
                )}

                {/* Selection ring */}
                {isSelected && (
                  <circle
                    r={NODE_RADIUS + 4}
                    fill="none"
                    stroke="var(--accent-info)"
                    strokeWidth={2}
                    strokeDasharray="6,4"
                  />
                )}

                {/* Label */}
                <text
                  x={0}
                  y={NODE_RADIUS + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                  fill="var(--text-primary)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {truncateLabel(node.label)}
                </text>

                {/* Type badge */}
                <text
                  x={0}
                  y={NODE_RADIUS + 29}
                  textAnchor="middle"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fill="var(--text-muted)"
                  style={{ pointerEvents: 'none', userSelect: 'none', textTransform: 'uppercase' }}
                >
                  {node.type.toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
        </g>
      </svg>

      <div className="attack-graph__legend">
        <div className="attack-graph__legend-item">
          <div className="attack-graph__legend-dot attack-graph__legend-dot--principal" />
          <span>Principal</span>
        </div>
        <div className="attack-graph__legend-item">
          <div className="attack-graph__legend-dot attack-graph__legend-dot--role" />
          <span>Role</span>
        </div>
        <div className="attack-graph__legend-item">
          <div className="attack-graph__legend-dot attack-graph__legend-dot--resource" />
          <span>Resource</span>
        </div>
        <div className="attack-graph__legend-item">
          <div className="attack-graph__legend-dot attack-graph__legend-dot--workload" />
          <span>Workload</span>
        </div>
        <div className="attack-graph__legend-item">
          <div className="attack-graph__legend-line attack-graph__legend-line--attack" />
          <span>Attack Path</span>
        </div>
        <div className="attack-graph__legend-item">
          <div className="attack-graph__legend-line attack-graph__legend-line--benign" />
          <span>Benign Workflow</span>
        </div>
      </div>

      {/* Selected node detail tooltip */}
      {selectedNode && (
        <NodeDetailTooltip
          node={selectedNode}
          truncateArn={(arn: string) => arn.length > 50 ? arn.slice(0, 50) + '…' : arn}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      <style>{`
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}

interface NodeDetailTooltipProps {
  node: GraphNode;
  truncateArn: (arn: string) => string;
  onClose: () => void;
}

function NodeDetailTooltip({ node, truncateArn, onClose }: NodeDetailTooltipProps) {
  const color = getNodeColor(node.type, node);

  return (
    <div
      className="glass-panel-strong"
      style={{
        position: 'absolute',
        top: 'var(--space-4)',
        right: 'var(--space-4)',
        minWidth: '280px',
        maxWidth: '360px',
        zIndex: 20,
        animation: 'fade-in-up var(--motion-fast) var(--ease-out)',
      }}
      role="dialog"
      aria-label="Node details"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color }} />
          {node.label}
        </h3>
        <button onClick={onClose} className="btn btn--ghost btn--icon btn--sm" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: '0.7rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>Type:</span>
          <span style={{ textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: color }}>{node.type}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>ARN:</span>
          <AwsRef value={node.arn} label={truncateArn(node.arn)} />
        </div>
        {node.isCompromised && (
          <span className="badge badge--attack" style={{ alignSelf: 'flex-start' }}>INITIAL COMPROMISE</span>
        )}
        {node.isTarget && (
          <span className="badge badge--attack" style={{ alignSelf: 'flex-start' }}>TARGET RESOURCE</span>
        )}
        {node.isOnAttackPath && !node.isCompromised && !node.isTarget && (
          <span className="badge badge--warning" style={{ alignSelf: 'flex-start' }}>ON ATTACK PATH</span>
        )}
      </div>
    </div>
  );
}
