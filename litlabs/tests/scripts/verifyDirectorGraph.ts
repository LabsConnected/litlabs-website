/**
 * Verify Director Graph
 * 
 * Validates the director relationship graph structure.
 */

export interface DirectorGraph {
  nodes: Array<{ id: string; type: string; dependencies?: string[] }>;
  edges: Array<{ from: string; to: string }>;
}

export interface VerificationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Verify a director graph has valid structure
 * - No circular dependencies
 * - All referenced nodes exist
 * - Valid DAG structure
 */
export function verifyDirectorGraph(graph: DirectorGraph): VerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  // Check all edges reference existing nodes
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge source node not found: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge target node not found: ${edge.to}`);
    }
  }

  // Check for self-references
  for (const edge of graph.edges) {
    if (edge.from === edge.to) {
      errors.push(`Self-referencing edge detected: ${edge.from}`);
    }
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const adjacencyList = new Map<string, string[]>();

  for (const node of graph.nodes) {
    adjacencyList.set(node.id, node.dependencies || []);
  }

  function hasCycle(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const neighbors = adjacencyList.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      if (hasCycle(node.id)) {
        errors.push("Circular dependency detected in director graph");
        break;
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

export default verifyDirectorGraph;