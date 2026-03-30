// src/models/mysql/User.ts

import { DataTypes, Model, Optional } from "sequelize";
import { getSequelize } from "../../config/mysql"; 

// ✅ Define attributes
interface UserAttributes {
  id: number;
  email: string;
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// For creation (id optional)
interface UserCreationAttributes extends Optional<UserAttributes, "id"> {}

export class User extends Model<UserAttributes, UserCreationAttributes>
  implements UserAttributes {
  public id!: number;
  public email!: string;
  public name!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

// ✅ INIT FUNCTION (ONLY ONE)
export const initUserModel = () => {
  const sequelize = getSequelize();

  if (!sequelize) {
    throw new Error("❌ Sequelize not initialized");
  }

User.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
      field: "user_id",
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "email",
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "first_name", // 👈 FIX HERE
    },
  },
  {
    sequelize,
    tableName: "users",
    timestamps: false,
  }
);
};