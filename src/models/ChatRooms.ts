import mongoose from "mongoose";

const chatRoomsSchema = new mongoose.Schema({
    name: {
        type: String,   //only for groups
        default: null
    },

    isGroup: {
        type: Boolean,
        default: false
    },

    participants: [
        {
            userId: {
                type: String  ,
                required: true
            },
            role: {
                type: String,
                enum: ["admin", "member"],
                default: "member"
            },
            joinedAt: {
                type: Date,
                default: Date.now
            }
        }
    ],
    lastMessage: {
        text: String,
        senderId: String,
        createdAt: Date
    },
    createdBy: {
        type: String
    }
}, { timestamps: true });

chatRoomsSchema.index({ "participants.userId": 1 });
export default mongoose.model("ChatRoom", chatRoomsSchema);