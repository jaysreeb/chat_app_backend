//Middleware to protect routes
import {Request, Response, NextFunction} from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request{
	userId?: number;
	email?: string;
	username?: string;
}

export const authenticateToken = (
	req: AuthRequest,
	res: Response,
	next: NextFunction
) => {
	const authHeader = req.headers.authorization;
	const token = authHeader?.split(' ')[1];
  	if(!token){
		return res.status(401).json({error: 'No access token Provided'});
	}
	const jwtSecret = process.env.JWT_SECRET;
	if(!jwtSecret){
		return res.status(500).json({error: "Env variables arent configured!"})
	}

	try{
		const decoded = jwt.verify(token, jwtSecret) as {userId: number; email: string; username: string};
		req.userId = decoded.userId;
		req.email = decoded.email;
		req.username = decoded.username;
		next();
	}catch(err){
		return res.status(403).json({error: 'Invalid or expired token'});
	}
};
