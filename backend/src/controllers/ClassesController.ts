import { Request, Response } from 'express';
import { object, string } from 'yup';

import db from '../database/connection';
import convertHourToMinutes from '../utils/convertHourToMinutes';

interface ScheduleItem {
  week_day: number;
  from: string;
  to: string;
}

export default class ClassesController {
  async index(request: Request, response: Response) {
    const filters = request.query;

    const week_day = filters.week_day as string;
    const subject = filters.subject as string;
    const time = filters.time as string;

    if (!filters.week_day || !filters.subject || !filters.time) {
      return response.status(400).json({
        error: 'Missing filters to search classes',
      });
    }

    const timeInMinutes = convertHourToMinutes(time);

    const classes = await db('classes')
      .whereExists(function () {
        this.select('class_schedule.*')
          .from('class_schedule')
          .whereRaw('class_schedule.class_id = classes.id')
          .whereRaw('class_schedule.week_day = ??', [Number(week_day)])
          .whereRaw('class_schedule.from <= ??', [timeInMinutes])
          .whereRaw('class_schedule.to > ??', [timeInMinutes]);
      })
      .where('classes.subject', '=', subject)
      .join('users', 'classes.user_id', '=', 'users.id')
      .select(['classes.*', 'users.*']);

    return response.json(classes);
  }

  async show(request: Request, response: Response) {
    const { id } = request.params;

    const classes = await db('classes').where({ user_id: id });

    return response.status(200).json(classes);
  }

  async showSchedules(request: Request, response: Response) {
    const { id } = request.params;

    const classes = await db('classes')
      .where({ user_id: id })
      .join('class_schedule', 'classes.id', '=', 'class_schedule.class_id')
      .select('class_schedule.id', 'week_day', 'from', 'to');

    return response.status(200).json(classes);
  }

  async create(request: Request, response: Response) {
    const { subject, cost, schedule } = request.body;

    const schema = object().shape({
      subject: string().required(),
      cost: string().required(),
      schedule: string().required(),
    });

    if (!(await schema.isValid(request.body))) {
      return response.status(400).json({ error: 'Validation fails' });
    }

    const { id } = request.params;

    const user = await db('users').select().where('id', id);

    if (!user[0])
      return response.status(400).send({ error: 'User not exists' });

    const trx = await db.transaction();

    try {
      const insertedClassesIds = await trx('classes')
        .insert({
          subject,
          cost,
          user_id: id,
        })
        .returning('id');

      const class_id = insertedClassesIds[0];

      const classSchedule = schedule.map((scheduleItem: ScheduleItem) => {
        return {
          class_id,
          week_day: scheduleItem.week_day,
          from: convertHourToMinutes(scheduleItem.from),
          to: convertHourToMinutes(scheduleItem.to),
        };
      });

      await trx('class_schedule').insert(classSchedule);

      await trx.commit();

      const updatedUser = await db('users').select().where({ id });

      return response.status(200).json(updatedUser[0]);
    } catch (error) {
      await trx.rollback();

      return response.status(400).json({
        error: 'Unexpected error while creating new class',
      });
    }
  }
}
