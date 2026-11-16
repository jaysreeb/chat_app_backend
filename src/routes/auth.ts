// API endpoints -Reg, Login, Refresh Token and Logout

import express, { type Request, type Response } from 'express';
import bcrypt from "bcrypt";
import pool from '../db';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import { error } from 'console';

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
    // Postgres error code '23505' indicates a UNIQUE constraint violation
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
    
    const query = await pool.query(`SELECT id, email, password_hashed, username FROM users WHERE email = $1`,[email]);
    const user = query.rows[0];
    
    const isMatch = await bcrypt.compare(password, user.password_hashed);

    if(!user){
      return res.status(401).json({error: "Invalid email or password"})
    }

    
    if(!isMatch){
      return res.status(401).json({error:"Invalid email or password"});
    }
    // JWT
    const payload ={
      userId: user.id,
      email: user.email,
      username: user.username
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
    const result = await pool.query(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, 
      [user.id, tokenHashed, refreshTokenExpiresAt]);
   
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


// TODO: Fix the errors and do the workflow again. 

router.post('/refresh', async(req: Request, res:Response) =>{
  const oldrefreshToken = req.cookies?.refreshToken;
  const refreshTokenSecret= process.env.JWT_REFRESH_SECRET;
  const jwtSecret = process.env.JWT_SECRET;
    
  if (!oldrefreshToken){
    return res.status(401).json({error:"Authentication error, Refresh Token missing"});
  }
  if (!refreshTokenSecret || !jwtSecret){
    return res.status(500).json({error: "Env variables are not configured"});
  }

  let decoded: JwtPayload;

  try {
    const verifiedData = jwt.verify(oldrefreshToken, refreshTokenSecret);
    if(typeof verifiedData === "string" || !verifiedData.userId){
      return res.status(401).json({error: "Invalid refresh token payload"});
    }

    decoded = verifiedData;
    
  } catch (jwtError){
    return res.status(401).json({error: "Refresh Token is expired or altered"});
  }

  const oldTokenHash = crypto.createHash('sha256').update(oldrefreshToken).digest('hex');
  const client = await pool.connect();
  try {

    await client.query('BEGIN');

    const result = await client.query(`
      SELECT u.id, u.email, u.username
      FROM users u
      JOIN refresh_tokens rt ON rt.user_id = u.id
      WHERE rt.token_hash = $1
      AND rt.user_id = $2
      AND rt.revoked_at IS NULL
      AND rt.expires_at > NOW()
      FOR UPDATE`,
    [oldTokenHash, decoded.userId]);

    if(result.rows.length === 0){
      await client.query('ROLLBACK');      
    }
    const user = result.rows[0];

    await client.query(`
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE token_hash = $1`,
    [oldTokenHash]);

    const payLoad = {
      userId: user.id,
      email: user.email,
      username: user.username
    };
    const newRefresheToken = jwt.sign(payLoad, refreshTokenSecret, {expiresIn:'7d'});
    const newAccessToken = jwt.sign(payLoad, jwtSecret, {expiresIn: '15m'});

    const newTokenHash = crypto.createHash('sha256').update(newRefresheToken).digest('hex');
    const newExpiresAt = new Date(Date.now()+7*24*60*60*1000);

    await client.query(`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES($1 , $2, $3)`,
    [user.id, newTokenHash, newExpiresAt]);

    await client.query('COMMIT');

    res.cookie('refreshToken', newRefresheToken,{
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7*24*60*60*1000,
    });

    return res.status(200).json({
      message: "Token rotated successfully",
      accessToken: newAccessToken,
      user:{
        id: user.id,
        email: user.email
      }
    });
  } catch (dbError){
    await client.query('ROLLBACK');
    console.error("Database error during rotation", dbError);
    return res.status(500).json({error:"Internal Server Error"});
  } finally{
    client.release();
  }
});

router.post('/logout', async(req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;

  const clearCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
  };

  if(!refreshToken){
    res.clearCookie('refreshToken', clearCookieOptions);
    return res.status(200).json({ message:'Logged out successfully'});
  }
  try {
    const tokenHashed = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await pool.query(`UPDATE refresh_tokens 
      SET revoked_at =NOW()
      WHERE token_hash = $1
      AND revoked_at IS NULL`,
      [tokenHashed]
    );

    res.clearCookie('refreshToken', clearCookieOptions);
    return res.status(200).json({ message: 'Logged out successfully' });
  }
  catch(error){
    console.error('Logout failed', error);
    res.clearCookie('refreshToken', clearCookieOptions);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
})

export default router;