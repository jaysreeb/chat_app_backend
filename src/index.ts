import { createServer } from 'node:http';
import {initWebSocketServer} from './websocket/server';
import * as dotenv from 'dotenv';
import app from './app';

dotenv.config();

const PORT = Number(process.env.PORT);

const server = createServer(app);
initWebSocketServer(server);

server.listen(PORT,'0.0.0.0',() => {
  console.log(`Server running on port ${PORT}`);
});