import { expect, it, vi } from "vitest";
import { Discord, DiscordError } from "../src/discord.js";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it("retries after a rate limit", async () => {
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(reply({ retry_after: 0.01 }, 429))
    .mockResolvedValueOnce(reply([{ id: "1", name: "a" }]));
  expect(await new Discord("t", fetchFn as typeof fetch).listGuilds()).toEqual([{ id: "1", name: "a" }]);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

it("gives up on a long rate limit", async () => {
  const fetchFn = vi.fn().mockResolvedValue(reply({ retry_after: 600 }, 429));
  await expect(new Discord("t", fetchFn as typeof fetch).listGuilds()).rejects.toBeInstanceOf(DiscordError);
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it("reports Discord errors with their status", async () => {
  const fetchFn = vi.fn().mockResolvedValue(reply({ message: "Missing Access" }, 403));
  await expect(new Discord("t", fetchFn as typeof fetch).listGuilds()).rejects.toMatchObject({ status: 403 });
});
