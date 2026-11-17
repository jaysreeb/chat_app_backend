import {WebSocketServer, WebSocket} from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { markDelivered, saveMessage, getUndeliveredMessages} from './messageService';

// --- TYPE DEFINITIONS ---
interface UserPayload{
    userId: number;
    email: string;
    username: string;
}

interface ConnectedClient extends UserPayload {
    socket: WebSocket;
    isAlive: boolean;  //Used for Ping/Pong heartbeat
}

interface IncomingTexts {
    type: 'message';
    to: number;
    content: string;
}

// Extend IncomingMessage to attach verified user during upgrade
interface AuthenticatedRequest extends IncomingMessage{
    user?: UserPayload;
}

// Global runtime Map to track active connections in RAM (O(1) lookups)
const clients = new Map<number, ConnectedClient>();

export function initWebSocketServer(server:Server){    
    const wss = new WebSocketServer({noServer: true }); 
    //Using noServer: true to authenticate BEFORE opening the socket
    server.on('upgrade', (req: AuthenticatedRequest, socket, head) => {

        const url = new URL(req.url || '', `http://${req.headers.host}`); 
        const token = url.searchParams.get('token');
        const secret = process.env.JWT_SECRET;

        if(!token || !secret){
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        try {
            const decoded = jwt.verify(token, secret) as UserPayload;
            if(!decoded || typeof decoded.userId !== 'number' || typeof decoded.email !== 'string' || typeof decoded.username !== 'string'){
                throw new Error(' Invalid payload');
            }
            req.user = decoded;
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('Connection', ws, req);
            });        
        } catch (err) {
            socket.write('HTTP/1.1 401 unauthorized\r\n\r\n');
            socket.destroy();
            return;            
        }
    });
    //Heartbeat interval to clean up dead/ghost connections every 30s
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach(ws) => {
            if(!wss.isAlive)
        }
    }, 30000);

    //Safely deliver offline messages
    //Strict runtime validation
    

}

async function handleMessage(senderId: number, msg: IncomingTexts){
    const sender = clients.get(senderId);
    const recipient = clients.get(msg.to);

    if(!sender) return;
    // Saving to DB
    const messageId = await saveMessage(senderId, msg.to, msg.content); 

    if(recipient && recipient.socket.readyState === WebSocket.OPEN){
        recipient.socket.send(JSON.stringify({
            type: 'message',
            from: senderId,
            fromUsername: sender.username,
            content: msg.content,
            timestamp: new Date().toISOString(),
        }));

        await markDelivered(messageId);

        sender.socket.send(JSON.stringify({
        type: 'delivered',
        to: msg.to,
        content: msg.content,
    }));
    }else{
        sender.socket.send(JSON.stringify({
            type: 'queued',
            message: 'USer is offline. Message will be delivered once online',
        }))        
    } 
}
