export interface BaseNode {
	nodeId: string;
	port: number;
	address: string;

	listen: (cb?: any) => Promise<void>;
	start: () => Promise<void>;
	handleMessage: (...args: any) => Promise<void>;
}
