// src/models/mysql/Fcm.ts

import { DataTypes, Model, Optional } from "sequelize";
import { getSequelize } from "../../config/mysql";

interface FcmAttributes {
  id: number;
  user_id: number;
  device_token: string;
  device_type: string;
}

interface FcmCreationAttributes
  extends Optional<FcmAttributes, "id"> {}

export class Fcm
  extends Model<FcmAttributes, FcmCreationAttributes>
  implements FcmAttributes
{
  public id!: number;
  public user_id!: number;
  public device_token!: string;
  public device_type!: string;
}

export const initFcmModel = () => {
  const sequelize = getSequelize();

  if (!sequelize) {
    throw new Error("Sequelize not initialized");
  }

  Fcm.init(
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },

      user_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
      },

      device_token: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      device_type: {
        type: DataTypes.ENUM("android", "ios", "web"),
        allowNull: false,
      },
    },
    {
      sequelize,
      tableName: "fcm",
      timestamps: false,
    }
  );
};