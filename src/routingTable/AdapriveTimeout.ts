import { setMaxListeners } from "events";
import { anySignal } from "any-signal";
import ClearableSignal from "any-signal";

/**
 * Implements exponential moving average. Ported from `moving-average`.
 *
 * @see https://en.wikipedia.org/wiki/Moving_average#Exponential_moving_average
 * @see https://www.npmjs.com/package/moving-average
 */
export class MovingAverage {
	public movingAverage: number;
	public variance: number;
	public deviation: number;
	public forecast: number;
	private readonly timespan: number;
	private previousTime?: number;

	constructor(timespan: number) {
		this.timespan = timespan;
		this.movingAverage = 0;
		this.variance = 0;
		this.deviation = 0;
		this.forecast = 0;
	}

	alpha(t: number, pt: number): number {
		return 1 - Math.exp(-(t - pt) / this.timespan);
	}

	push(value: number, time: number = Date.now()): void {
		if (this.previousTime != null) {
			// calculate moving average
			const a = this.alpha(time, this.previousTime);
			const diff = value - this.movingAverage;
			const incr = a * diff;
			this.movingAverage = a * value + (1 - a) * this.movingAverage;
			// calculate variance & deviation
			this.variance = (1 - a) * (this.variance + diff * incr);
			this.deviation = Math.sqrt(this.variance);
			// calculate forecast
			this.forecast = this.movingAverage + a * diff;
		} else {
			this.movingAverage = value;
		}

		this.previousTime = time;
	}
}
/**
 * Create tracked metrics with these options. Loosely based on the
 * interfaces exposed by the prom-client module
 */
export interface MetricOptions {
	/**
	 * Optional label for the metric
	 */
	label?: string;

	/**
	 * Optional help for the metric
	 */
	help?: string;
}

/**
 * A function that returns a tracked metric which may be expensive
 * to calculate so it is only invoked when metrics are being scraped
 */
export type CalculateMetric<T = number> = (() => T) | (() => Promise<T>);

/**
 * Create tracked metrics that are expensive to calculate by passing
 * a function that is only invoked when metrics are being scraped
 */
export interface CalculatedMetricOptions<T = number> extends MetricOptions {
	/**
	 * An optional function invoked to calculate the component metric instead of
	 * using `.update`, `.increment`, and `.decrement`
	 */
	calculate: CalculateMetric<T>;
}

/**
 * Call this function to stop the timer returned from the `.timer` method
 * on the metric
 */
export interface StopTimer {
	(): void;
}

/**
 * A tracked metric loosely based on the interfaces exposed by the
 * prom-client module
 */
export interface Metric {
	/**
	 * Update the stored metric to the passed value
	 */
	update(value: number): void;

	/**
	 * Increment the metric by the passed value or 1
	 */
	increment(value?: number): void;

	/**
	 * Decrement the metric by the passed value or 1
	 */
	decrement(value?: number): void;

	/**
	 * Reset this metric to its default value
	 */
	reset(): void;

	/**
	 * Start a timed metric, call the returned function to
	 * stop the timer
	 */
	timer(): StopTimer;
}

/**
 * A group of related metrics loosely based on the interfaces exposed by the
 * prom-client module
 */
export interface MetricGroup<T extends string = any> {
	/**
	 * Update the stored metric group to the passed value
	 */
	update(values: Partial<Record<T, number>>): void;

	/**
	 * Increment the metric group keys by the passed number or
	 * `true` to increment by 1
	 */
	increment(values: Partial<Record<T, number | true>>): void;

	/**
	 * Decrement the metric group keys by the passed number or
	 * `true` to decrement by 1
	 */
	decrement(values: Partial<Record<T, number | true>>): void;

	/**
	 * Reset the passed key in this metric group to its default value
	 * or all keys if no key is passed
	 */
	reset(): void;

	/**
	 * Start a timed metric for the named key in the group, call
	 * the returned function to stop the timer
	 */
	timer(key: string): StopTimer;
}

/**
 * A tracked counter loosely based on the Counter interface exposed
 * by the prom-client module - counters are metrics that only go up
 */
export interface Counter {
	/**
	 * Increment the metric by the passed value or 1
	 */
	increment(value?: number): void;

	/**
	 * Reset this metric to its default value
	 */
	reset(): void;
}

/**
 * A group of tracked counters loosely based on the Counter interface
 * exposed by the prom-client module - counters are metrics that only
 * go up
 */
export interface CounterGroup<T extends string = any> {
	/**
	 * Increment the metric group keys by the passed number or
	 * any non-numeric value to increment by 1
	 */
	increment(values: Partial<Record<T, number | true>>): void;

	/**
	 * Reset the passed key in this metric group to its default value
	 * or all keys if no key is passed
	 */
	reset(): void;
}

export interface HistogramOptions extends MetricOptions {
	/**
	 * Buckets for the histogram
	 */
	buckets?: number[];
}

/**
 * Create tracked metrics that are expensive to calculate by passing
 * a function that is only invoked when metrics are being scraped
 */
export interface CalculatedHistogramOptions<T = number> extends HistogramOptions {
	/**
	 * An optional function invoked to calculate the component metric instead of
	 * using `.observe`
	 */
	calculate: CalculateMetric<T>;
}

export interface Histogram {
	/**
	 * Observe the passed value
	 */
	observe(value: number): void;

	/**
	 * Reset this histogram to its default value
	 */
	reset(): void;

	/**
	 * Start a timed metric, call the returned function to
	 * stop the timer
	 */
	timer(): StopTimer;
}

export interface HistogramGroup<T extends string = any> {
	/**
	 * Observe the passed value for the named key in the group
	 */
	observe(values: Partial<Record<T, number>>): void;

	/**
	 * Reset the passed key in this histogram group to its default value
	 * or all keys if no key is passed
	 */
	reset(): void;

	/**
	 * Start a timed metric for the named key in the group, call
	 * the returned function to stop the timer
	 */
	timer(key: string): StopTimer;
}

export interface SummaryOptions extends MetricOptions {
	/**
	 * Percentiles for the summary
	 */
	percentiles?: number[];

	/**
	 * Configure how old a bucket can be before it is reset for sliding window
	 */
	maxAgeSeconds?: number;

	/**
	 * Configure how many buckets in the sliding window
	 */
	ageBuckets?: number;

	/**
	 * Remove entries without any new values in the last `maxAgeSeconds`
	 */
	pruneAgedBuckets?: boolean;

	/**
	 * Control compression of data in t-digest
	 */
	compressCount?: number;
}

/**
 * Create tracked metrics that are expensive to calculate by passing
 * a function that is only invoked when metrics are being scraped
 */
export interface CalculatedSummaryOptions<T = number> extends SummaryOptions {
	/**
	 * An optional function invoked to calculate the component metric instead of
	 * using `.observe`
	 */
	calculate: CalculateMetric<T>;
}

/**
 * A tracked summary loosely based on the Summary interface exposed
 * by the prom-client module
 */
export interface Summary {
	/**
	 * Observe the passed value
	 */
	observe(value: number): void;

	/**
	 * Reset this summary to its default value
	 */
	reset(): void;

	/**
	 * Start a timed metric, call the returned function to
	 * stop the timer
	 */
	timer(): StopTimer;
}

/**
 * A group of tracked summaries loosely based on the Summary interface
 * exposed by the prom-client module
 */
export interface SummaryGroup<T extends string = any> {
	/**
	 * Observe the passed value for the named key in the group
	 */
	observe(values: Partial<Record<T, number>>): void;

	/**
	 * Reset the passed key in this summary group to its default value
	 * or all keys if no key is passed
	 */
	reset(): void;

	/**
	 * Start a timed metric for the named key in the group, call
	 * the returned function to stop the timer
	 */
	timer(key: string): StopTimer;
}

/**
 * The libp2p metrics tracking object. This interface is only concerned
 * with the collection of metrics, please see the individual implementations
 * for how to extract metrics for viewing.
 *
 * @example How to register a simple metric
 *
 * ```typescript
 * import { Metrics, Metric } from '@libp2p/interface/metrics'
 *
 * interface MyServiceComponents {
 *   metrics: Metrics
 * }
 *
 * class MyService {
 *   private readonly myMetric: Metric
 *
 *   constructor (components: MyServiceComponents) {
 *     this.myMetric = components.metrics.registerMetric({
 *       name: 'my_metric',
 *       label: 'my_label',
 *       help: 'my help text'
 *     })
 *   }
 *
 *   // later
 *   doSomething () {
 *     this.myMetric.update(1)
 *   }
 * }
 * ```
 *
 * @example How to register a dynamically calculated metric
 *
 * A metric that is expensive to calculate can be created by passing a `calculate` function that will only be invoked when metrics are being scraped:
 *
 * ```typescript
 * import { Metrics, Metric } from '@libp2p/interface/metrics'
 *
 * interface MyServiceComponents {
 *   metrics: Metrics
 * }
 *
 * class MyService {
 *   private readonly myMetric: Metric
 *
 *   constructor (components: MyServiceComponents) {
 *     this.myMetric = components.metrics.registerMetric({
 *       name: 'my_metric',
 *       label: 'my_label',
 *       help: 'my help text',
 *       calculate: async () => {
 *         // do something expensive
 *         return 1
 *       }
 *     })
 *   }
 * }
 * ```
 *
 * @example How to register a group of metrics
 *
 * If several metrics should be grouped together (e.g. for graphing purposes) `registerMetricGroup` can be used instead:
 *
 * ```typescript
 * import { Metrics, MetricGroup } from '@libp2p/interface/metrics'
 *
 * interface MyServiceComponents {
 *   metrics: Metrics
 * }
 *
 * class MyService {
 *   private readonly myMetricGroup: MetricGroup
 *
 *   constructor (components: MyServiceComponents) {
 *     this.myMetricGroup = components.metrics.registerMetricGroup({
 *       name: 'my_metric_group',
 *       label: 'my_label',
 *       help: 'my help text'
 *     })
 *   }
 *
 *   // later
 *   doSomething () {
 *     this.myMetricGroup.increment({ my_label: 'my_value' })
 *   }
 * }
 * ```
 *
 * There are specific metric groups for tracking libp2p connections and streams:
 *
 * @example How to track multiaddr connections
 *
 * This is something only libp2p transports need to do.
 *
 * ```typescript
 * import { Metrics } from '@libp2p/interface/metrics'
 *
 * interface MyServiceComponents {
 *   metrics: Metrics
 * }
 *
 * class MyService {
 *   private readonly metrics: Metrics
 *
 *   constructor (components: MyServiceComponents) {
 *     this.metrics = components.metrics
 *   }
 *
 *   // later
 *   doSomething () {
 *     const connection = {} // create a connection
 *     this.metrics.trackMultiaddrConnection(connection)
 *   }
 * }
 * ```
 *
 * @example How to track protocol streams
 *
 * This is something only libp2p connections need to do.
 *
 * ```typescript
 * import { Metrics } from '@libp2p/interface/metrics'
 *
 * interface MyServiceComponents {
 *   metrics: Metrics
 * }
 *
 * class MyService {
 *   private readonly metrics: Metrics
 *
 *   constructor (components: MyServiceComponents) {
 *     this.metrics = components.metrics
 *   }
 *
 *   // later
 *   doSomething () {
 *     const stream = {} // create a stream
 *     this.metrics.trackProtocolStream(stream)
 *   }
 * }
 * ```
 */
export interface Metrics {
	/**
	 * Track a newly opened multiaddr connection
	 */
	trackMultiaddrConnection(maConn: any): void;

	/**
	 * Track a newly opened protocol stream
	 */
	trackProtocolStream(stream: any, connection: any): void;

	/**
	 * Register an arbitrary metric. Call this to set help/labels for metrics
	 * and update/increment/decrement/etc them by calling methods on the returned
	 * metric object
	 */
	registerMetric: ((name: string, options?: MetricOptions) => Metric) &
		((name: string, options: CalculatedMetricOptions) => void);

	/**
	 * Register a a group of related metrics. Call this to set help/labels for
	 * groups of related metrics that will be updated with by calling `.update`,
	 * `.increment` and/or `.decrement` methods on the returned metric group object
	 */
	registerMetricGroup: ((name: string, options?: MetricOptions) => MetricGroup) &
		((name: string, options: CalculatedMetricOptions<Record<string, number>>) => void);

	/**
	 * Register an arbitrary counter. Call this to set help/labels for counters
	 * and increment them by calling methods on the returned counter object
	 */
	registerCounter: ((name: string, options?: MetricOptions) => Counter) &
		((name: string, options: CalculatedMetricOptions) => void);

	/**
	 * Register a a group of related counters. Call this to set help/labels for
	 * groups of related counters that will be updated with by calling the `.increment`
	 * method on the returned counter group object
	 */
	registerCounterGroup: ((name: string, options?: MetricOptions) => CounterGroup) &
		((name: string, options: CalculatedMetricOptions<Record<string, number>>) => void);

	/**
	 * Register an arbitrary histogram. Call this to set help/labels for histograms
	 * and observe them by calling methods on the returned histogram object
	 */
	registerHistogram: ((name: string, options?: HistogramOptions) => Histogram) &
		((name: string, options: CalculatedHistogramOptions) => void);

	/**
	 * Register a a group of related histograms. Call this to set help/labels for
	 * groups of related histograms that will be updated with by calling the `.observe`
	 * method on the returned histogram group object
	 */
	registerHistogramGroup: ((name: string, options?: HistogramOptions) => HistogramGroup) &
		((name: string, options: CalculatedHistogramOptions<Record<string, number>>) => void);

	/**
	 * Register an arbitrary summary. Call this to set help/labels for summaries
	 * and observe them by calling methods on the returned summary object
	 */
	registerSummary: ((name: string, options?: SummaryOptions) => Summary) &
		((name: string, options: CalculatedSummaryOptions) => void);

	/**
	 * Register a a group of related summaries. Call this to set help/labels for
	 * groups of related summaries that will be updated with by calling the `.observe`
	 * method on the returned summary group object
	 */
	registerSummaryGroup: ((name: string, options?: SummaryOptions) => SummaryGroup) &
		((name: string, options: CalculatedSummaryOptions<Record<string, number>>) => void);
}
export const DEFAULT_TIMEOUT_MULTIPLIER = 1.2;
export const DEFAULT_FAILURE_MULTIPLIER = 2;
export const DEFAULT_MIN_TIMEOUT = 2000;

export interface AdaptiveTimeoutSignal {
	start: number;
	timeout: number;
}

export interface AdaptiveTimeoutInit {
	metricName?: string;
	metrics?: Metrics;
	interval?: number;
	initialValue?: number;
	timeoutMultiplier?: number;
	failureMultiplier?: number;
	minTimeout?: number;
}

export interface GetTimeoutSignalOptions {
	timeoutFactor?: number;
	signal?: AbortSignal;
}

export class AdaptiveTimeout {
	private readonly success: MovingAverage;
	private readonly failure: MovingAverage;
	private readonly next: MovingAverage;
	private readonly metric?: MetricGroup;
	private readonly timeoutMultiplier: number;
	private readonly failureMultiplier: number;
	private readonly minTimeout: number;

	constructor(init: AdaptiveTimeoutInit = {}) {
		this.success = new MovingAverage(init.interval ?? 5000);
		this.failure = new MovingAverage(init.interval ?? 5000);
		this.next = new MovingAverage(init.interval ?? 5000);
		this.failureMultiplier = init.failureMultiplier ?? DEFAULT_FAILURE_MULTIPLIER;
		this.timeoutMultiplier = init.timeoutMultiplier ?? DEFAULT_TIMEOUT_MULTIPLIER;
		this.minTimeout = init.minTimeout ?? DEFAULT_MIN_TIMEOUT;

		if (init.metricName != null) {
			this.metric = init.metrics?.registerMetricGroup(init.metricName);
		}
	}

	getTimeoutSignal(options: GetTimeoutSignalOptions = {}): AdaptiveTimeoutSignal {
		// calculate timeout for individual peers based on moving average of
		// previous successful requests
		const timeout = Math.max(
			Math.round(this.next.movingAverage * (options.timeoutFactor ?? this.timeoutMultiplier)),
			this.minTimeout,
		);
		const sendTimeout = AbortSignal.timeout(timeout);
		const timeoutSignal = anySignal([options.signal, sendTimeout]) as any;
		setMaxListeners(Infinity, timeoutSignal, sendTimeout);

		timeoutSignal.start = Date.now();
		timeoutSignal.timeout = timeout;

		return timeoutSignal;
	}

	cleanUp(signal: any): void {
		const time = Date.now() - signal.start;

		if (signal.aborted) {
			this.failure.push(time);
			this.next.push(time * this.failureMultiplier);
			this.metric?.update({
				failureMovingAverage: this.failure.movingAverage,
				failureDeviation: this.failure.deviation,
				failureForecast: this.failure.forecast,
				failureVariance: this.failure.variance,
				failure: time,
			});
		} else {
			this.success.push(time);
			this.next.push(time);
			this.metric?.update({
				successMovingAverage: this.success.movingAverage,
				successDeviation: this.success.deviation,
				successForecast: this.success.forecast,
				successVariance: this.success.variance,
				success: time,
			});
		}
	}
}
