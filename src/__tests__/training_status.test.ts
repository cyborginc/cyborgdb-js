/**
 * `getTrainingStatus()` against a local stand-in, so no service is needed.
 * Mirrors py tests/test_training_status.py.
 */
import { CyborgDBServiceError } from "../errors";
import { Client } from "../index";
import { startStandIn } from "./test-helpers";

let failWith: number | undefined;
let standIn: Awaited<ReturnType<typeof startStandIn>>;

beforeAll(async () => {
	standIn = await startStandIn(() =>
		failWith !== undefined
			? { status: failWith, body: { detail: "boom" } }
			: {
					body: {
						training_indexes: ["a", "b"],
						retrain_threshold: 10000,
						currently_training: "a",
						queued_indexes: ["b"],
						worker_running: true,
						worker_pid: 1234,
						global_training: { a: { started: 1 } },
					},
				},
	);
});

afterAll(() => standIn.close());

beforeEach(() => {
	failWith = undefined;
	standIn.requests.length = 0;
});

const client = () => new Client({ baseUrl: standIn.url, apiKey: "k" });

describe("getTrainingStatus()", () => {
	it("returns only the two documented fields", async () => {
		expect(await client().getTrainingStatus()).toEqual({
			trainingIndexes: ["a", "b"],
			retrainThreshold: 10000,
		});
	});

	it("calls the training-status endpoint", async () => {
		await client().getTrainingStatus();
		expect(standIn.requests).toEqual([
			expect.objectContaining({
				method: "GET",
				url: "/v1/indexes/training-status",
			}),
		]);
	});

	it("maps errors to typed errors", async () => {
		failWith = 500;
		await expect(client().getTrainingStatus()).rejects.toThrow(
			CyborgDBServiceError,
		);
	});
});
