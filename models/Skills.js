import mongoose from "mongoose";

const skillSchema = new mongoose.Schema({
    seeker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    name: {
        type: String,
        required: [true, "Please provide a skill name"],
        trim: true,
        maxlength: [100, "Skill name cannot exceed 100 characters"],
    },
    category: {
        type: String,
        required: [true, "Please provide a skill category"],
        trim: true,
        maxlength: [100, "Category cannot exceed 100 characters"],
    },
    endorsements: {
        type: Number,
        default: 0,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

skillSchema.pre("save", function (next) {
    this.updatedAt = Date.now();
    next();
});

const Skill = mongoose.model("Skill", skillSchema);

export default Skill;