import express, {Response} from 'express';
import authRoutes from './routes/auth';
import usersRouter from './routes/users';
import { AuthRequest, authenticateToken} from './middleware/auth';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/users', authenticateToken, usersRouter);
app.get('/api/me', authenticateToken, (req: AuthRequest, res:Response) => {
  res.json({
    message: 'You are authenticated',
    userId: req.userId,
    email: req.email,
    username: req.username,
  });
});

export default app;