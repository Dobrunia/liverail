import { createSocketIoClientTransport } from "../src/index.js";

/**
 * Проверяет на уровне типов, что Socket.IO client transport можно создать
 * по одному `url`, не поднимая socket вручную в самом частом сценарии.
 * Это важно, потому что ergonomic default должен сокращать стандартный
 * bootstrap-код, но при этом оставлять типобезопасный путь для настроек.
 * Также покрывается corner case с обязательностью одного источника socket,
 * чтобы пользователь не передавал одновременно и `url`, и готовый socket.
 */
createSocketIoClientTransport({
  url: "http://127.0.0.1:3000",
  socketOptions: {
    reconnection: false
  }
});

createSocketIoClientTransport(
  // @ts-expect-error transport must receive either a socket or an url source
  {}
);
