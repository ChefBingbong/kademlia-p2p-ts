export interface BaseNode {
	nodeId: number;
	port: number;
	address: string;

	listen: (cb?: any) => void;
	start: () => Promise<void>;
	handleMessage: (...args: any) => Promise<void>;
}
