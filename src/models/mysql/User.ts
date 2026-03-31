// src/models/mysql/User.ts

import { DataTypes, Model, Optional } from "sequelize";
import { getSequelize } from "../../config/mysql";

interface UserAttributes {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
  profile_picture: string;
}

// For creation (id optional)
interface UserCreationAttributes extends Optional<UserAttributes, "id"> { }

export class User extends Model<UserAttributes, UserCreationAttributes>
  implements UserAttributes {
  public id!: number;
  public email!: string;
  public name!: string;
  public first_name!: string;
  public last_name!: string
  public profile_picture!: string

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

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
      first_name: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "first_name", 
      },
      name: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "first_name", 
      },
      last_name: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "last_name", 
      },
      profile_picture: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "profile_picture",
      },
    },
    {
      sequelize,
      tableName: "users",
      timestamps: false,
    }
  );
};