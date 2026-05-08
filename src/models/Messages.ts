import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ChatRooms",
    required: true
  },

  senderId: {
    type: String,
    required: true
  },

  message: String,

  messageType: {
    type: String,
    enum: ["text", "image", "video", "file", "poll"],
    default: "text"
  },

  mediaUrl: String,

  reactions: [
    {
      userId: {
        type: String,
        required: true
      },

      reaction: {
        type: String,
        default: ""
      },

      reactionUrl: {
        type: String,
        required: true
      },

      reactedAt: {
        type: Date,
        default: Date.now
      }
    }
  ],

  poll: {
    question: {
      type: String,
      default: ""
    },

    options: [
      {
        optionId: {
          type: String,
          required: true
        },

        text: {
          type: String,
          required: true
        },

        votes: [
          {
            userId: String,

            votedAt: {
              type: Date,
              default: Date.now
            }
          }
        ]
      }
    ],

    allowMultipleAnswers: {
      type: Boolean,
      default: false
    }
  },

  deliveredTo: [
    {
      userId: String,
      deliveredAt: Date
    }
  ],

  readBy: [
    {
      userId: String,
      readAt: Date
    }
  ],

  deletedFor: [
    {
      userId: String,
      deletedAt: Date
    }
  ],
  isDeleted: {
    type: Boolean,
    default: false
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  senderName: {
    type: String,
    required: true
  },
  senderProfile: {
    type: String,
    default: null
  },
  replyMessage: {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Messages",
      default: null
    },

    senderId: String,

    senderName: String,

    message: String,

    messageType: String,

    mediaUrl: String
  },

}, { timestamps: true });

messageSchema.index({ roomId: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);