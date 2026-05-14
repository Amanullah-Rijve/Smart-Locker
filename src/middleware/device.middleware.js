import dotenv from "dotenv";

dotenv.config();

const deviceMiddleware = (req, res, next) => {
    const deviceKey = req.headers["x-device-key"];

    if (!deviceKey || deviceKey !== process.env.DEVICE_KEY) {
    return res.status(403).json({
        success: false,
        message: "Access denied. Invalid device key.",
    });
    }

    next();
};

export default deviceMiddleware;