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
                wss.emit('connection', ws, req);
            });        
        } catch (err) {
            socket.write('HTTP/1.1 401 unauthorized\r\n\r\n');
            socket.destroy();
            return;            
        }
    });

    //Heartbeat interval to clean up dead/ghost connections every 30s
    const heartbeatInterval = setInterval (() =>{
        clients.forEach((client, userId) => {
            if (!client.isAlive){
                console.log(`Termianting ghost connection for ${userId}`);
                client.socket.terminate();
                // clients.delete(userId);
                return;
            }
            client.isAlive = false;
            client.socket.ping();
        });
    }, 30000);

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });

    wss.on('connection', async(socket: WebSocket, req: AuthenticatedRequest) =>{
        const user = req.user!;
        const {userId, email, username} = user;

        const existingClient = clients.get(userId);
        if(existingClient){
            existingClient.socket.close(4002, 'Connected from another location');
        }
        clients.set(userId, {userId, email, username, socket, isAlive: true});
        console.log(`User ${email} connected. Online: ${clients.size}`);
        socket.on('pong', () => {
            const client = clients.get(userId);
            if (client) client.isAlive = true;
        });
        socket.send(JSON.stringify({
            type: 'connected',
            message: 'connected Successfully',
        }));
        //Safely deliver offline messages
        try {
            const undelivered = await getUndeliveredMessages(userId);
            if (undelivered.length > 0 && socket.readyState === WebSocket.OPEN){
                for(const msg of undelivered){
                    socket.send(JSON.stringify({
                        //Delivering offline msgs
                        type:'message',
                        id:msg.id,
                        from: msg.sender_id,
                        content:msg.content,
                        timeStamp:msg.created_at,
                    }));
                    await markDelivered(msg.id);
                }
                socket.send(JSON.stringify({
                    type: 'info',
                    message: `${undelivered.length} undelivered msgs delivered`,
                }));
            }
            
        } catch (err) {
            console.error(`Failed to fetch undelivered messages for ${userId}:`, err);            
        }
        socket.on('message', async(data) =>{
            try {
                // Limit payload size
                if(data.toString().length > 10000){
                    socket.send(JSON.stringify({
                        type: 'error', message: 'Message too large'
                    }));
                    return;
                }
                const parsed = JSON.parse(data.toString());

                // Runtime Validation
                if(
                    parsed.type === 'message'&&
                    typeof parsed.to === 'number' &&
                    typeof parsed.content === 'string' &&
                    parsed.content.trim().length > 0
                ){
                    await handleMessage(userId, parsed as IncomingTexts);
                }else{
                    socket.send(JSON.stringify({type: 'error', message:'Invalid message payload'}));
                }                
            } catch (error){
                console.log('MEssage handler error:', error);
                socket.send(JSON.stringify({type:'error', message:'Invalid JSON format'}));                
            }
        });

        socket.on('close', () =>{
            if(clients.get(userId)?.socket === socket){
                clients.delete(userId);
                console.log(`User ${email} disconnected. Online: ${clients.size}`);
            }
        });       
    });
    console.log('Websocket server initialized');
}

async function handleMessage(senderId: number, msg: IncomingTexts){
    const sender = clients.get(senderId);

    if(!sender) return;

    if (senderId === msg.to){
        sender.socket.send(JSON.stringify({ type: 'error', message: 'Cannot send message to yourself' }));
        return;
    }
    try{
        const messageId = await saveMessage(senderId, msg.to, msg.content);
        const recipient = clients.get(msg.to);

        if(recipient && recipient.socket.readyState === WebSocket.OPEN){
            recipient.socket.send(JSON.stringify({
                type: 'message',
                id: messageId,
                from: senderId,
                fromUsername: sender.username,
                content: msg.content,
                timeStamp: new Date().toISOString(),
            }));

            await markDelivered(messageId);
            
            if (sender.socket.readyState === WebSocket.OPEN){
                sender.socket.send(JSON.stringify({
                type: 'delivered',
                id: messageId,
                to: msg.to,
                content: msg.content,
            }));
            }
        }else if(sender.socket.readyState === WebSocket.OPEN){
            sender.socket.send(JSON.stringify({
                type: 'queued',
                id: messageId,
                message: 'User is offline. Message will be delivered once online.',
            }));
        }
    }catch(dbErr){
        console.error('Database error in handleMessage:', dbErr);
        if (sender.socket.readyState === WebSocket.OPEN) {
            sender.socket.send(JSON.stringify({
                type: 'error',
                message: 'Failed to send message. Recipient may not exist.',
            }));
        }
    }
}
