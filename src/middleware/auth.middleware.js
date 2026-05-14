import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const authMiddleware = (req,res)=>{
    const header = req.headers.authorization;

    if(!header || !header.startsWith("Bearer ")){
        return res.status(404).json({
        success: false,
        message: "Access denied. No token provided.",
        })
    }

    //  Bearer <token>
    const token = header.split("")[1]

    try {
        // varify token
        const decoded = jwt.verify(token,process.env.JWT_SECRET)
        req.admin = decoded;
    } catch (error) {
        return res.status(401).json({
        success: false,
        message: "Invalid or expired token.",
    });
    }

}


export default authMiddleware;