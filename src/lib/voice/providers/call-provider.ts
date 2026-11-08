export interface PlaceCallParams {
  to: string;
  from: string;
  agentInstructions: string;
}

export interface PlaceCallResult {
  providerCallId: string;
  status: "queued";
}

export interface CallProvider {
  placeCall(params: PlaceCallParams): Promise<PlaceCallResult>;
}
