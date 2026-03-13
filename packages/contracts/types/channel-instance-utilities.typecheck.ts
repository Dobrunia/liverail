import { z } from "zod";

import {
  channel,
  createChannelInstance,
  isSameChannelInstance,
  parseChannelInstance,
  stringifyChannelInstance
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что channel instance utilities сохраняют
 * точный key shape и дают typed API для `channel.of(...)`, stringify/parse
 * и equality без деградации в `unknown`. Это важно, потому что этот слой
 * станет общим источником истины для client, server и transport adapter-ов.
 * Также покрывается corner case с parsed instance, чтобы key-тип после
 * десериализации оставался тем же самым, что и у исходного channel contract.
 */
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const fromContract = voiceRoom.of({
  roomId: "room-1"
});
const fromFactory = createChannelInstance(voiceRoom, {
  roomId: "room-1"
});
const serialized = stringifyChannelInstance(fromContract);
const parsed = parseChannelInstance(voiceRoom, serialized);

fromContract.id;
parsed.key.roomId;
isSameChannelInstance(fromContract, fromFactory);
stringifyChannelInstance("voice-room", fromFactory.key);
