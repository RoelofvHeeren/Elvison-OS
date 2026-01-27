/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures from external APIs by tracking failure rates
 * and temporarily blocking requests when threshold is exceeded.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failure threshold exceeded, requests fail fast
 * - HALF_OPEN: Testing if service recovered
 */

export class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000; // 60s
        this.monitoringPeriod = options.monitoringPeriod || 60000; // 60s

        this.state = 'CLOSED';
        this.failures = [];
        this.nextAttempt = Date.now();
        this.successCount = 0;
    }

    /**
     * Execute a function with circuit breaker protection
     */
    async execute(fn, fallback = null) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                console.warn(`[CircuitBreaker] Circuit OPEN, rejecting request`);
                if (fallback) return fallback();
                throw new Error('Circuit breaker is OPEN');
            }
            // Try to recover
            this.state = 'HALF_OPEN';
            console.log(`[CircuitBreaker] Entering HALF_OPEN state`);
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (error) {
            this._onFailure(error);
            if (fallback) return fallback();
            throw error;
        }
    }

    _onSuccess() {
        if (this.state === 'HALF_OPEN') {
            console.log(`[CircuitBreaker] Service recovered, closing circuit`);
            this.state = 'CLOSED';
            this.failures = [];
            this.successCount = 0;
        } else {
            this.successCount++;
        }
    }

    _onFailure(error) {
        const now = Date.now();
        this.failures.push({ timestamp: now, error: error.message });

        // Remove old failures outside monitoring period
        this.failures = this.failures.filter(
            f => now - f.timestamp < this.monitoringPeriod
        );

        console.warn(`[CircuitBreaker] Failure recorded: ${error.message} (${this.failures.length}/${this.failureThreshold})`);

        if (this.failures.length >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = now + this.resetTimeout;
            console.error(`[CircuitBreaker] Circuit OPEN - too many failures. Will retry at ${new Date(this.nextAttempt).toISOString()}`);
        }
    }

    getState() {
        return {
            state: this.state,
            failures: this.failures.length,
            nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null
        };
    }

    reset() {
        this.state = 'CLOSED';
        this.failures = [];
        this.successCount = 0;
        console.log(`[CircuitBreaker] Circuit manually reset`);
    }
}

/**
 * Error Aggregator
 * Collects multiple errors during batch operations instead of failing fast
 */
export class ErrorAggregator {
    constructor() {
        this.errors = [];
    }

    add(error, context = {}) {
        this.errors.push({
            message: error.message,
            stack: error.stack,
            context,
            timestamp: new Date().toISOString()
        });
    }

    hasErrors() {
        return this.errors.length > 0;
    }

    getErrors() {
        return this.errors;
    }

    getSummary() {
        return {
            count: this.errors.length,
            errors: this.errors.map(e => ({
                message: e.message,
                context: e.context,
                timestamp: e.timestamp
            }))
        };
    }

    throwIfErrors() {
        if (this.hasErrors()) {
            const summary = this.getSummary();
            const error = new Error(`Batch operation failed with ${summary.count} errors`);
            error.details = summary;
            throw error;
        }
    }
}
