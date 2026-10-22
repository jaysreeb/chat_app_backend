import express, { type Request, type Response } from 'express';
import bcrypt from "bcrypt";
import pool from '../db';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';


const router = express.Router();

router.post('/register', async(req: Request, res: Response) =>{
  const{email, password, username} = req.body;
  try {
      if (!email || !password || !username) {
        return res.status(400).json({ message: 'All the fields are required' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format'});
      }
      if (password.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
      }

      const password_hashed = await bcrypt.hash(password,10);

      const result = await pool.query(`INSERT INTO users(email,password_hashed,username)
        VALUES($1,$2,$3)
        RETURNING id,email, username,created_at`,
        [email,password_hashed,username])
      
      return res.status(201).json({
        message:"Registered Succesfully",
        user: result.rows[0]
      })

  }catch (error: any){
    if(error.code === '23505'){
      return res.status(409).json({message:"Duplicate or Empty Email/username"})
    }
    console.error('Registration failed:', error);
    return res.status(500).json({message: "Internal Server Error"});
  }
});
router.post('/login',async(req: Request, res: Response) =>{
  const {email, password} = req.body;
  try {
    if(!email || !password){
      return res.status(400).json({error:"Email and Passwords are required"});
    }
    
    const query = await pool.query(`SELECT id, email, password_hashed FROM users WHERE email = $1`,[email]);
    const user = query.rows[0];
    if(!user){
      return res.status(401).json({error: "Invalid email or password"})
    }

    const isMatch = await bcrypt.compare(password, user.password_hashed);
    
    if(!isMatch){
      return res.status(401).json({error:"Invalid email or password"});
    }
    // JWT
    const payload ={
      userId: user.id,
      email: user.email,
    }
    const secret_key= process.env.JWT_SECRET;
    const refreshTokenSecret= process.env.JWT_REFRESH_SECRET;

    if(!secret_key || !refreshTokenSecret){
      throw new Error('JWT secrets are not configured');
    }

    const token = jwt.sign(payload, secret_key,{
      expiresIn: '15m'
    })
    
    const refreshToken = jwt.sign(payload, refreshTokenSecret,{
      expiresIn:'7d'
    });

    const tokenHashed = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const refreshTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);  
    // Save hashed token to DB
    const result = await pool.query(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [user.id, tokenHashed, refreshTokenExpiresAt]);
    console.log('Refresh token row inserted:', result.rowCount);

    res.cookie('refreshToken',refreshToken,{
      httpOnly: true,
      secure: process.env.NODE_ENV ==='production',
      sameSite:'strict',
      maxAge: 7*24*60*60*1000,
    })

    return res.status(200).json({
      message:"Login Successful",
      accessToken: token,
      user:{
        id: user.id,
        email: user.email,
      },
    });

  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({error:"Internal Server Error"})    
  }
});

router.post('/refresh', async(req: Request, res:Response) =>{
  // write refresh endpoint
  const refreshToken = req.cookies.refreshToken;
  const refreshTokenSecret= process.env.JWT_REFRESH_SECRET;
  
  if (!refreshToken){
    return res.status(401).json({error:"Authentication error, Refresh Token missing"})
  }
  if (!refreshTokenSecret){
    return res.status(500).json({error: "Refresh Token secret is not configured"})
  }

  // JWT refresh token verify
  try {
    const decoded = jwt.verify(refreshToken, refreshTokenSecret);
    if(typeof decoded === "string" || typeof decoded.userId !== "number" || decoded.userId <= 0)
    {
      return res.status(401).json({error: "Invalid refresh token payload"});
    }
    const jwtSecret = process.env.JWT_SECRET;

    if(!jwtSecret){
      return res.status(500).json({error:'JWT Secret inst configured, Internal Server Error'});
    }
    const tokenHashed = crypto.createHash('sha256').update(refreshToken).digest('hex');
  // Check for refreshtoken in db
    const result = await pool.query
    (`SELECT id, user_id FROM refresh_tokens 
      WHERE token_hash = $1 
      AND revoked_at IS NULL 
      AND expires_at > NOW()`, 
      [tokenHashed]);
  
    if(result.rows.length ===0){
    return res.status(401).json({error: 'Refresh Token is invalid,expired, or revoked'});
    }

    const payLoad = {userId: decoded.userId}
    const newAccessToken = jwt.sign(payLoad, jwtSecret,{
      expiresIn: '15m'
    })

    return res.status(200).json({
      message:"Token Created",
      AccessToken: newAccessToken,
      user: decoded.userId
    })
      
  } catch (error) {
    return res.status(500).json({error: "Internal Server Error"})    
  }
})

router.post('/logout', async(req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;
  if(!refreshToken){
    return res.status(200).json({ message:'Logged out successfully'});
  }
  try {
    const tokenHashed = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await pool.query(`UPDATE refresh_tokens 
      SET revoked_at =NOW()
      WHERE token_hash = $1
      AND revoked_at IS NULL`,
      [tokenHashed]);

  } catch (error) {
    console.error('Logout failed:', error);
    return res.status(500).json({error: 'Internal Server Error'})    
  }
  res.clearCookie('refreshToken',{
    httpOnly: true,
    secure: process.env.NODE_ENV ==='production',
    sameSite: 'strict',
  });

  return res.status(200).json({message: 'Logged out successfully'});
})

export default router;