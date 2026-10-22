import { expect, test } from 'vitest';
import request from 'supertest';
import app from '../src/app';


test('rejects and incorrect password', async() =>{
    const response = await request(app)
    .post('/api/auth/login')
    .send({
        'email':'test@test.com',
        'password':'123456'
    })
    .expect(401)
    .expect('Content-Type', /json/)
    .expect({error: 'Invalid email or password'})
});
