import {WebSocketServer, WebSocket} from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { markDelivered, saveMessage, getUndeliveredMessages} from './messageService';

interface ConnectedClient {
    userId: number;
    email: string;
    username: string;
    socket: WebSocket;
}
interface IncomingMessage1 {
    type: 'message';
    to: number;
    content: string;
}

const clients = new Map<number, ConnectedClient>();

export function initWebSocketServer(server:Server){
    const wss = new WebSocketServer({server});

    wss.on('connection', async(socket: WebSocket, req: IncomingMessage) => {
        // console.log("CONNECTED");
        const url = new URL(req.url!, 'http://${req.headers.host}');
        const token = url.searchParams.get('token');

        if(!token){
            socket.close(1000, 'No token provided');
            return;
        }

        let decoded: {userId: number; email: string; username: string};
        try {
            decoded = jwt.verify(
                token,
                process.env.JWT_SECRET as string
            ) as {userId: number; email: string; username: string};            
        } catch (err) {
            socket.close(1000, 'Invalid token');
            return;            
        }

        const {userId, email, username} = decoded;

        clients.set(userId, {userId, email, username, socket});
        // console.log(`User ${email} connected. Online: ${clients.size}`);

        socket.send(JSON.stringify({
            type: 'connected',
            message: 'Connected Successfully',
        }))

        const undelivered = await getUndeliveredMessages(userId);
        
        if(undelivered.length > 0){
            for (const msg of undelivered){
                socket.send(JSON.stringify({
                    type: 'message',
                    id: msg.id,
                    from: msg.sender_id,
                    content: msg.content,
                    timestamp: msg.created_at,
                }));
                await markDelivered(msg.id);
            }
            socket.send(JSON.stringify({
                type: 'info',
                message:`${undelivered.length} Undelivered messages are delivered now.`
            }));
        }

        socket.on('message', async(data) =>{
        try{
            const parsed: IncomingMessage1 = JSON.parse(data.toString());
            
            if(parsed.type === 'message'){
                await handleMessage(userId, parsed);
            }
        }catch(err){
            // console.error('Message handler error:', err); 
            socket.send(JSON.stringify({type:'error', message:'Invalid message format'}))
        }
        });

        socket.on('close', () => {
            clients.delete(userId);
            console.log(`User ${email} disconnected. Online: ${clients.size}`);
        });
        //  console.log('WebSocket server initialized');
    });
}

async function handleMessage(senderId: number, msg: IncomingMessage1){
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

