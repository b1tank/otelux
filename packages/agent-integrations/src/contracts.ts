export type AgentId = 'claude-code' | 'codex' | 'pi';
export type AgentScope = 'local' | 'project' | 'user';
export type AgentCapabilityId = 'mcp' | 'skills' | 'plugin' | 'telemetry' | 'sensitive-content';

export interface AgentDescriptor {
	readonly id: AgentId;
	readonly displayName: string;
	readonly documentationUrl: string;
}

export interface DetectedInstallation {
	readonly executable: string;
	readonly version: string;
	readonly supported: boolean;
	readonly reason?: string;
}

export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown-version';
export type CapabilityConfiguration = 'configured' | 'not-configured' | 'unknown';
export type CapabilityVerification = 'verified' | 'not-verified' | 'failed' | 'not-applicable';

export interface AgentCapabilityState {
	readonly id: AgentCapabilityId;
	readonly support: CapabilitySupport;
	readonly configuration: CapabilityConfiguration;
	readonly verification: CapabilityVerification;
	readonly sensitive?: boolean;
	readonly reason?: string;
}

export interface InspectedPath {
	readonly path: string;
	readonly scope: AgentScope;
	readonly kind: 'file' | 'directory';
	readonly exists: boolean;
	readonly secure: boolean;
	readonly sha256?: string;
	readonly issues: readonly string[];
}

export interface AgentInspection {
	readonly agent: AgentDescriptor;
	readonly detected: boolean;
	readonly installations: readonly DetectedInstallation[];
	readonly capabilities: readonly AgentCapabilityState[];
	readonly paths: readonly InspectedPath[];
	readonly restartRequired: boolean;
	readonly issues: readonly string[];
}

export interface CommandResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface CommandRunner {
	run(executable: string, args: readonly string[]): Promise<CommandResult>;
}

export interface InspectPathRequest {
	readonly path: string;
	readonly allowedRoot: string;
	readonly scope: AgentScope;
	readonly kind: 'file' | 'directory';
	readonly hashContents?: boolean;
}

export interface PathInspector {
	inspect(request: InspectPathRequest): Promise<InspectedPath>;
}

export interface AgentAdapterContext {
	readonly homeDirectory: string;
	readonly workingDirectory: string;
	readonly commandRunner: CommandRunner;
	readonly pathInspector: PathInspector;
}

export interface AgentAdapter {
	readonly descriptor: AgentDescriptor;
	inspect(context: AgentAdapterContext): Promise<AgentInspection>;
}
